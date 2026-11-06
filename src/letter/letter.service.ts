import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Brackets, DataSource, In } from 'typeorm';
import { CreateMusicDto } from '../music/dto/create-music.dto';
import { CreateLetterDto } from './dto/create-letter.dto';
import { LetterEntity } from './entities/letter.entity';
import { LetterboxTab } from './enums/letterbox-tab.enum';
import { UserEntity } from '../user/entities/user.entity';
import { RecordService } from '../record/record.service';
import { RecordEntity } from '../record/entities/record.entity';
import { RecordFileEntity } from '../record/entities/record-file.entity';
import { R2Service } from '../storage/r2.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationStatus } from '../notification/enums/notification.enum';
import { UserService } from '../user/user.service';
import {
  getDisplayNickname,
  isRestrictedUser,
  isWithdrawnUser,
  RESTRICTED_USER_NICKNAME,
} from '../user/withdrawn-user';
import { BlockService } from '../block/block.service';
import { notBlockedBetweenSql } from '../block/block.sql';

const DAY_MS = 24 * 60 * 60 * 1000;

// 편지가 도착한 시각. 예약 없이 보낸 편지(delivery_at NULL)는 보낸 즉시 도착한다.
// 편지함 쿼리는 record 를 조인해 두어서 그대로 쓴다
const LETTER_ARRIVED_AT_SQL = 'COALESCE(letter.delivery_at, record.created_at)';

@Injectable()
export class LetterService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recordService: RecordService,
    private readonly r2Service: R2Service,
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
    private readonly blockService: BlockService,
  ) { }

  async createLetter(senderId: number, dto: CreateLetterDto) {
    const music = this.parseMusic(dto.music);

    const now = new Date();
    const receiverId = await this.userService.getIdByPublicId(dto.receiverId);

    // 내가 차단했거나 나를 차단한 사람에게는 보낼 수 없다
    if (
      senderId !== receiverId &&
      (await this.blockService.isBlockedBetween(senderId, receiverId))
    ) {
      throw new ForbiddenException('편지를 보낼 수 없는 사용자입니다.');
    }

    const deliveryAt = dto.deliveryAt ? new Date(dto.deliveryAt) : null;
    const isDelivered = deliveryAt === null || deliveryAt <= now;

    // 알림 크론(LetterNotificationScheduler)이 볼 필요 없는 알림은 만들 때 처리 표시를 해 둔다.
    // - 바로 도착하는 편지: 도착 알림은 아래에서 바로 보낸다
    // - 도착 예정 알림: 나에게 쓴 편지이거나 도착까지 24시간이 안 남았으면 보내지 않는다
    const skipArrivingSoon =
      deliveryAt === null ||
      isDelivered ||
      senderId === receiverId ||
      deliveryAt.getTime() - now.getTime() < DAY_MS;

    const result = await this.dataSource.transaction(async (manager) => {
      const record = await this.recordService.createBaseRecord(manager, {
        userId: senderId,
        music,
        text: dto.text,
        font: dto.font,
      });

      /*
       * 업로드가 끝난 파일을 같은 트랜잭션에서 붙입니다.
       * 첨부가 실패하면 레코드도 함께 롤백되어 반쪽짜리 편지가 남지 않습니다.
       */
      await this.recordService.attachFiles(manager, {
        recordId: record.id,
        userId: senderId,
        files: dto.files ?? [],
        isNewRecord: true,
      });

      const letter = manager.create(LetterEntity, {
        recordId: record.id,
        senderId,
        receiverId,
        deliveryAt,
        pattern: dto.pattern,
        color: dto.color,
        stamp: dto.stamp,
        receivedNotifiedAt: isDelivered ? now : null,
        arrivingSoonNotifiedAt: skipArrivingSoon ? now : null,
      });

      const savedLetter = await manager.save(LetterEntity, letter);

      return {
        message: '편지가 생성되었습니다.',
        recordId: record.id,
        letterId: savedLetter.id,
      };
    });

    // 커밋된 뒤에 보낸다. 알림이 실패해도 편지 작성은 성공으로 응답한다.
    if (isDelivered) {
      void this.notificationService.notify({
        userId: receiverId,
        status: NotificationStatus.RECEIVE,
        actorId: senderId,
        letterId: Number(result.letterId),
      });
    }

    return result;
  }

  async getLetterDetail(params: {
    letterId: number;
    userId: number;
  }) {
    const { letterId, userId } = params;

    if (!letterId || Number.isNaN(letterId)) {
      throw new BadRequestException('letterId가 올바르지 않습니다.');
    }

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    return this.dataSource.transaction(async (manager) => {
      const letter = await manager
        .getRepository(LetterEntity)
        .createQueryBuilder('letter')
        .leftJoinAndSelect('letter.record', 'record')
        .leftJoinAndSelect('record.user', 'sender')
        .leftJoinAndSelect('record.music', 'music')
        .leftJoinAndSelect('record.files', 'files')
        .leftJoinAndMapOne(
          'letter.receiver',
          UserEntity,
          'receiver',
          'receiver.id = letter.receiverId',
        )
        .where('letter.id = :letterId', { letterId })
        .orderBy('files.id', 'ASC')
        .getOne();

      if (!letter) {
        throw new NotFoundException('편지를 찾을 수 없습니다.');
      }

      const senderId = Number(letter.record.userId);
      const receiverId = Number(letter.receiverId);

      const isSender = senderId === userId;
      const isReceiver = receiverId === userId;

      if (!isSender && !isReceiver) {
        throw new ForbiddenException('편지를 열람할 권한이 없습니다.');
      }

      if (this.isDeletedByUser(letter, userId)) {
        throw new NotFoundException('편지를 찾을 수 없습니다.');
      }

      const now = new Date();
      const isDelivered =
        letter.deliveryAt === null || letter.deliveryAt <= now;

      if (isReceiver && !isDelivered) {
        throw new ForbiddenException('아직 열람할 수 없는 편지입니다.');
      }

      // 차단한 뒤에 도착한 편지는 없는 편지로 본다. 차단 전에 받은 편지 · 내가 보낸 편지는 그대로 보인다
      if (
        isReceiver &&
        !isSender &&
        (await this.blockService.isBlockedBetween(
          userId,
          senderId,
          letter.deliveryAt ?? letter.record.createdAt,
        ))
      ) {
        throw new NotFoundException('편지를 찾을 수 없습니다.');
      }

      if (isReceiver && !letter.isRead) {
        letter.isRead = true;
        await manager.save(LetterEntity, letter);
      }

      // 운영자가 가린 편지는 모양은 같게 두고 글 · 음악 · 사진만 비워서 내려준다 (보낸 사람에게도 같다)
      const isBlinded = !!letter.blindedAt;

      // 받은 편지에서 내가 보낸 사람을 차단했는지. 앱이 답장 대신 차단 해제 안내를 띄운다
      // (상대가 나를 차단한 사실은 알려주지 않는다)
      const isSenderBlocked =
        isReceiver && !isSender
          ? await this.blockService.hasBlocked(userId, senderId)
          : false;

      return {
        isBlinded,
        isSenderBlocked,
        letter: {
          id: Number(letter.id),
          recordId: Number(letter.recordId),
          receiverId: letter.receiver?.publicId ?? null,
          receiver: this.formatLetterboxUser(letter.receiver),
          pattern: letter.pattern,
          color: letter.color,
          stamp: letter.stamp,
          deliveryAt: letter.deliveryAt,
          isRead: letter.isRead,
        },
        record: {
          id: Number(letter.record.id),
          userId: letter.record.user?.publicId ?? null,
          musicId: Number(letter.record.musicId),
          text: isBlinded ? null : letter.record.text,
          font: letter.record.font,
          createdAt: letter.record.createdAt,
          updatedAt: letter.record.updatedAt,
          user: letter.record.user
            ? {
              id: letter.record.user.publicId,
              // 앱이 신고 · 차단 · 차단 해제 토스트에 '@아이디'로 쓴다 (탈퇴한 회원은 null)
              userCode: letter.record.user.userCode ?? null,
              nickname: this.getLetterUserNickname(letter.record.user),
              profileImageUrl: this.r2Service.getProfileImageUrl(letter.record.user),
              isWithdrawn: isWithdrawnUser(letter.record.user),
              isRestricted: isRestrictedUser(letter.record.user),
            }
            : null,
          music: isBlinded ? null : letter.record.music,
          files: isBlinded ? [] : letter.record.files?.map((file) => ({
            id: Number(file.id),
            recordId: Number(file.recordId),
            url: this.r2Service.getPublicUrl(file.fileKey),
            fileType: file.fileType,
            fileSize: Number(file.fileSize),
            mimeType: file.mimeType,
            originalName: file.originalName,
            createdAt: file.createdAt,
          })) ?? [],
        },
      };
    });
  }

  async getLetterbox(params: {
    userId: number;
    tab: LetterboxTab;
    cursor?: number;
    limit?: number;
  }) {
    const { userId, tab, cursor } = params;

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    if (cursor !== undefined && (!cursor || Number.isNaN(cursor))) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다.');
    }

    const safeLimit = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const now = new Date();

    const qb = this.createLetterboxQueryBuilder()
      .orderBy('letter.id', 'DESC')
      // 조인이 전부 N:1이라 행이 늘어나지 않는다. take()를 쓰면 TypeORM이 id만 뽑는
      // DISTINCT 쿼리를 한 번 더 날리므로, 왕복 한 번으로 끝나는 limit()을 쓴다.
      .limit(safeLimit + 1)
      .setParameter('userId', userId)
      .setParameter('now', now);

    // 내가 삭제한 편지는 내 편지함에서만 빠진다 (sender/receiverDeletedAt)
    switch (tab) {
      case LetterboxTab.UNREAD:
        qb.where('letter.receiverId = :userId')
          .andWhere('letter.receiverDeletedAt IS NULL')
          .andWhere('letter.isRead = false')
          // 운영자가 가린 편지는 안 읽은 편지 묶음에 보여주지 않는다
          .andWhere('letter.blindedAt IS NULL')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.RECEIVED:
        qb.where('letter.receiverId = :userId')
          .andWhere('letter.receiverDeletedAt IS NULL')
          .andWhere('letter.senderId != :userId')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.SENT:
        qb.where('letter.senderId = :userId')
          .andWhere('letter.senderDeletedAt IS NULL')
          .andWhere('letter.receiverId != :userId');
        break;
      case LetterboxTab.SELF:
        qb.where('letter.senderId = :userId')
          .andWhere('letter.receiverId = :userId')
          .andWhere('letter.senderDeletedAt IS NULL')
          .andWhere(
            '(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
          );
        break;
      case LetterboxTab.ALL:
        qb.where(
          new Brackets((w) => {
            w.where(
              '(letter.senderId = :userId AND letter.senderDeletedAt IS NULL)',
            ).orWhere(
              '(letter.receiverId = :userId AND letter.receiverDeletedAt IS NULL)',
            );
          }),
        ).andWhere(
          '(letter.receiverId != :userId OR letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)',
        );
        break;
      default:
        throw new BadRequestException('tab 값이 올바르지 않습니다.');
    }

    // 차단한 뒤에 도착한 편지는 뺀다. 차단 전에 받은 편지 · 내가 보낸 편지는 그대로 둔다
    qb.andWhere(
      `(letter.receiverId != :userId OR ${notBlockedBetweenSql(':userId', 'letter.sender_id', LETTER_ARRIVED_AT_SQL)})`,
    );

    if (cursor !== undefined) {
      qb.andWhere('letter.id < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasNext = rows.length > safeLimit;
    const items = (hasNext ? rows.slice(0, safeLimit) : rows).map((letter) =>
      this.formatLetterboxItem(letter, userId),
    );
    const lastItem = items[items.length - 1];

    return {
      items,
      nextCursor: hasNext && lastItem ? lastItem.letterId : null,
      hasNext,
    };
  }

  // 우표 상세의 편지 목록. 이 우표가 붙은 "수집한 편지"를 도착 시각이 최근인 순으로 준다.
  // 수집한 편지 = 나에게 도착한 편지(나에게 쓴 편지 포함), 내가 삭제한 편지 · 차단한 뒤에 도착한 편지 · 운영자가 가린 편지는 제외.
  // (StampService.getStampCollection의 count와 같은 조건)
  async getCollectedLettersByStamp(params: { userId: number; stamp: string }) {
    const { userId, stamp } = params;

    const rows = await this.createLetterboxQueryBuilder()
      .where('letter.receiverId = :userId', { userId })
      .andWhere('letter.stamp = :stamp', { stamp })
      .andWhere('letter.receiverDeletedAt IS NULL')
      // 운영자가 가린 편지는 우표 수집에서 뺀다
      .andWhere('letter.blindedAt IS NULL')
      .andWhere('(letter.deliveryAt IS NULL OR letter.deliveryAt <= :now)', {
        now: new Date(),
      })
      .andWhere(
        notBlockedBetweenSql(
          ':userId',
          'letter.sender_id',
          LETTER_ARRIVED_AT_SQL,
        ),
      )
      .getMany();

    return rows
      .map((letter) => ({
        ...this.formatLetterboxItem(letter, userId),
        // 도착 시각. 예약 없이 보낸 편지(deliveryAt null)는 보낸 즉시 도착한다.
        arrivedAt: letter.deliveryAt ?? letter.record.createdAt,
      }))
      .sort(
        (a, b) =>
          b.arrivedAt.getTime() - a.arrivedAt.getTime() ||
          b.letterId - a.letterId,
      );
  }

  // 편지 삭제. 삭제한 사람의 편지함에서만 숨기고, 상대방 편지함에는 그대로 남긴다.
  // 단, 도착 전 편지를 보낸 사람이 삭제하면 받는 사람에게도 도착하지 않는다.
  async deleteLetter(params: { letterId: number; userId: number }) {
    const { letterId, userId } = params;

    if (!letterId || Number.isNaN(letterId)) {
      throw new BadRequestException('letterId가 올바르지 않습니다.');
    }

    if (!userId || Number.isNaN(userId)) {
      throw new BadRequestException('userId가 올바르지 않습니다.');
    }

    return this.dataSource.transaction(async (manager) => {
      const letter = await manager.findOne(LetterEntity, {
        where: { id: letterId },
      });

      if (!letter) {
        throw new NotFoundException('삭제할 편지를 찾을 수 없습니다.');
      }

      const isSender = Number(letter.senderId) === userId;
      const isReceiver = Number(letter.receiverId) === userId;

      if (!isSender && !isReceiver) {
        throw new ForbiddenException('편지를 삭제할 권한이 없습니다.');
      }

      const now = new Date();
      const isDelivered =
        letter.deliveryAt === null || letter.deliveryAt <= now;

      // 이미 삭제했거나, 받는 사람 입장에서 아직 도착하지 않은 편지는 편지함에 없는 편지다
      if (this.isDeletedByUser(letter, userId) || (!isSender && !isDelivered)) {
        throw new NotFoundException('삭제할 편지를 찾을 수 없습니다.');
      }

      // 도착 전에 보낸 사람이 삭제한 편지는 발송 취소로 보고, 받는 사람에게도 도착하지 않게
      // 양쪽을 함께 삭제한다. 나에게 쓴 편지도 보낸/받은 쪽을 함께 삭제한다.
      const deleteForReceiver = isReceiver || (isSender && !isDelivered);

      await manager.update(
        LetterEntity,
        { id: letterId },
        {
          ...(isSender && { senderDeletedAt: now }),
          ...(deleteForReceiver && { receiverDeletedAt: now }),
        },
      );

      return {
        message: '편지가 삭제되었습니다.',
        letterId,
      };
    });
  }

  async purgeDeletedLetters(days = 30, limit = 100) {
    const cutoff = new Date(Date.now() - days * DAY_MS);

    return this.dataSource.transaction(async (manager) => {
      // 보낸 사람과 받는 사람이 모두 삭제했고, 늦게 삭제한 쪽 기준으로 보관 기간이 지난 편지
      const letters = await manager
        .getRepository(LetterEntity)
        .createQueryBuilder('letter')
        .select(['letter.id', 'letter.recordId', 'letter.senderId'])
        .where('letter.senderDeletedAt <= :cutoff', { cutoff })
        .andWhere('letter.receiverDeletedAt <= :cutoff', { cutoff })
        .orderBy('letter.id', 'ASC')
        .limit(limit)
        .getMany();

      if (letters.length === 0) {
        return {
          message: '물리 삭제할 편지가 없습니다.',
          targetCount: 0,
          deletedLetterCount: 0,
          deletedRecordFileCount: 0,
          deletedRecordCount: 0,
        };
      }

      const letterIds = letters.map((letter) => Number(letter.id));
      const recordIds = [
        ...new Set(letters.map((letter) => Number(letter.recordId))),
      ];

      // 편지 record의 작성자는 보낸 사람이다 (senderId = record.userId)
      const senderIdByRecordId = new Map(
        letters.map((letter) => [
          Number(letter.recordId),
          Number(letter.senderId),
        ]),
      );

      const filesToDelete = await manager.find(RecordFileEntity, {
        where: { recordId: In(recordIds) },
      });

      const letterDeleteResult = await manager.delete(LetterEntity, {
        id: In(letterIds),
      });

      const recordFileDeleteResult = await manager.delete(RecordFileEntity, {
        recordId: In(recordIds),
      });

      const recordDeleteResult = await manager.delete(RecordEntity, {
        id: In(recordIds),
      });

      /*
       * R2 삭제는 크론에 맡깁니다.
       * 여기서 바로 지우면 이 트랜잭션이 롤백됐을 때 객체만 사라집니다.
       */
      await this.recordService.detachFiles(
        manager,
        filesToDelete.map((file) => ({
          userId: senderIdByRecordId.get(Number(file.recordId)) ?? 0,
          fileKey: file.fileKey,
          mimeType: file.mimeType,
        })),
      );

      return {
        message: '삭제 보관 기간이 지난 편지가 물리 삭제되었습니다.',
        targetCount: letters.length,
        deletedLetterCount: letterDeleteResult.affected ?? 0,
        deletedRecordFileCount: recordFileDeleteResult.affected ?? 0,
        deletedRecordCount: recordDeleteResult.affected ?? 0,
      };
    });
  }

  // 편지함 목록 아이템(formatLetterboxItem)을 만들 때 필요한 조인
  private createLetterboxQueryBuilder() {
    return this.dataSource
      .getRepository(LetterEntity)
      .createQueryBuilder('letter')
      .leftJoinAndSelect('letter.record', 'record')
      .leftJoinAndSelect('record.user', 'sender')
      .leftJoinAndSelect('record.music', 'music')
      .leftJoinAndMapOne(
        'letter.receiver',
        UserEntity,
        'receiver',
        'receiver.id = letter.receiverId',
      );
  }

  private isDeletedByUser(letter: LetterEntity, userId: number) {
    const isSender = Number(letter.senderId) === userId;
    const isReceiver = Number(letter.receiverId) === userId;

    return (
      (isSender && letter.senderDeletedAt !== null) ||
      (isReceiver && letter.receiverDeletedAt !== null)
    );
  }

  private formatLetterboxItem(letter: LetterEntity, userId: number) {
    // 운영자가 가린 편지는 음악을 비우고 isBlinded 만 알려준다
    const isBlinded = !!letter.blindedAt;

    return {
      letterId: Number(letter.id),
      isBlinded,
      // 보낸 시각 = 작성해서 보낸 시각. letter와 record는 같은 트랜잭션에서 생성된다.
      createdAt: letter.record.createdAt,
      deliveryAt: letter.deliveryAt,
      isRead: letter.isRead,
      isSender: Number(letter.senderId) === userId,
      isReceiver: Number(letter.receiverId) === userId,
      envelope: {
        pattern: letter.pattern,
        color: letter.color,
        stamp: letter.stamp,
      },
      sender: this.formatLetterboxUser(letter.record.user),
      receiver: this.formatLetterboxUser(letter.receiver),
      music: letter.record.music && !isBlinded
        ? {
          musicId: Number(letter.record.music.id),
          musicTitle: letter.record.music.musicTitle,
          musicArtist: letter.record.music.musicArtist,
          musicArtwork: letter.record.music.musicArtwork,
        }
        : null,
    };
  }

  private formatLetterboxUser(user?: UserEntity | null) {
    if (!user) {
      return null;
    }

    return {
      userId: user.publicId,
      nickname: this.getLetterUserNickname(user),
      profileImageUrl: this.r2Service.getProfileImageUrl(user),
      isWithdrawn: isWithdrawnUser(user),
      isRestricted: isRestrictedUser(user),
    };
  }

  // 편지에 보여주는 이름. 탈퇴한 회원 → '(탈퇴한 회원)', 이용 제한된 회원 → '(이용 제한된 회원)'
  private getLetterUserNickname(user: UserEntity) {
    if (!isWithdrawnUser(user) && isRestrictedUser(user)) {
      return RESTRICTED_USER_NICKNAME;
    }

    return getDisplayNickname(user);
  }

  private parseMusic(music: string): CreateMusicDto {
    try {
      return JSON.parse(music) as CreateMusicDto;
    } catch {
      throw new BadRequestException('music 형식이 올바르지 않습니다.');
    }
  }
}