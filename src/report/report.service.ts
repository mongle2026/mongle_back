import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ReportContentSnapshot, ReportEntity } from './entities/report.entity';
import { ReportTargetType } from './enums/report.enum';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportDiscordService } from './discord/report-discord.service';
import { FeedEntity } from '../feed/entities/feed.entity';
import { FeedCommentEntity } from '../feed-comment/entities/feed-comment.entity';
import { LetterEntity } from '../letter/entities/letter.entity';
import { RecordEntity } from '../record/entities/record.entity';
import { UserEntity } from '../user/entities/user.entity';
import { isDuplicateEntryError } from '../database/mysql-error.util';

type CreateReportParams = {
  reporterId: number;
  reportedUserId: number;
  targetType: ReportTargetType;
  targetId: number;
  contentSnapshot: ReportContentSnapshot;
  dto: CreateReportDto;
};

/*
 * 신고. 저장하면 디스코드 채널로 알림을 보낸다. 받은 신고를 보는 화면은 없다.
 * 처리 전인 신고가 있는 대상을 다시 신고해도 에러 없이 응답하고, isAlreadyReported 로 알려준다.
 * 처리(가림 · 경고 · 영구 정지 · 기각)가 끝난 대상은 다시 신고할 수 있다.
 * 지워진 대상, 탈퇴한 회원, 나 자신이나 내가 쓴 글은 신고할 수 없다.
 */
@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(ReportEntity)
    private readonly reportRepository: Repository<ReportEntity>,

    private readonly dataSource: DataSource,
    private readonly reportDiscordService: ReportDiscordService,
  ) {}

  async reportFeed(
    currentUserId: number,
    feedId: number,
    dto: CreateReportDto,
  ) {
    // 삭제한 피드는 조회되지 않는다
    const feed = await this.dataSource.getRepository(FeedEntity).findOne({
      where: { id: feedId },
      relations: { record: { music: true, files: true } },
    });

    if (!feed) {
      throw new NotFoundException('피드를 찾을 수 없습니다.');
    }

    return await this.createReport({
      reporterId: currentUserId,
      reportedUserId: Number(feed.record.userId),
      targetType: ReportTargetType.FEED,
      targetId: Number(feed.id),
      contentSnapshot: {
        ...this.toRecordSnapshot(feed.record),
        visibility: feed.visibility,
      },
      dto,
    });
  }

  async reportComment(
    currentUserId: number,
    commentId: number,
    dto: CreateReportDto,
  ) {
    const comment = await this.dataSource
      .getRepository(FeedCommentEntity)
      .findOne({ where: { id: commentId } });

    if (!comment) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }

    return await this.createReport({
      reporterId: currentUserId,
      reportedUserId: Number(comment.userId),
      targetType: ReportTargetType.COMMENT,
      targetId: Number(comment.id),
      contentSnapshot: {
        feedId: Number(comment.feedId),
        content: comment.content,
      },
      dto,
    });
  }

  // 받은 편지만 신고할 수 있다. 도착 전이거나 내 편지함에서 지운 편지는 없는 편지로 본다
  async reportLetter(
    currentUserId: number,
    letterId: number,
    dto: CreateReportDto,
  ) {
    const letter = await this.dataSource.getRepository(LetterEntity).findOne({
      where: { id: letterId },
      relations: { record: { music: true, files: true } },
    });

    const isDelivered =
      !!letter &&
      (letter.deliveryAt === null || letter.deliveryAt <= new Date());

    if (
      !letter ||
      Number(letter.receiverId) !== currentUserId ||
      letter.receiverDeletedAt !== null ||
      !isDelivered
    ) {
      throw new NotFoundException('편지를 찾을 수 없습니다.');
    }

    return await this.createReport({
      reporterId: currentUserId,
      reportedUserId: Number(letter.senderId),
      targetType: ReportTargetType.LETTER,
      targetId: Number(letter.id),
      contentSnapshot: this.toRecordSnapshot(letter.record),
      dto,
    });
  }

  async reportUser(
    currentUserId: number,
    targetPublicId: string,
    dto: CreateReportDto,
  ) {
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      select: {
        id: true,
        userCode: true,
        nickname: true,
        profileImageKey: true,
        defaultProfileImageNo: true,
      },
      where: { publicId: targetPublicId, withdrawnAt: IsNull() },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    return await this.createReport({
      reporterId: currentUserId,
      reportedUserId: Number(user.id),
      targetType: ReportTargetType.USER,
      targetId: Number(user.id),
      contentSnapshot: {
        publicId: targetPublicId,
        userCode: user.userCode,
        nickname: user.nickname,
        profileImageKey: user.profileImageKey,
        defaultProfileImageNo: user.defaultProfileImageNo,
      },
      dto,
    });
  }

  private async createReport({
    reporterId,
    reportedUserId,
    targetType,
    targetId,
    contentSnapshot,
    dto,
  }: CreateReportParams) {
    if (reporterId === reportedUserId) {
      throw new BadRequestException(
        '자기 자신이나 내가 쓴 글은 신고할 수 없습니다.',
      );
    }

    let report: ReportEntity;

    try {
      report = await this.reportRepository.save(
        this.reportRepository.create({
          reporterId,
          reportedUserId,
          targetType,
          targetId,
          reason: dto.reason,
          detail: dto.detail ?? null,
          contentSnapshot,
        }),
      );
    } catch (error) {
      // 처리 전인 신고가 이미 있으면 그 신고만 남기고, 디스코드 알림도 다시 보내지 않는다
      if (isDuplicateEntryError(error)) {
        return { isReported: true, isAlreadyReported: true };
      }

      throw error;
    }

    // 알림이 실패해도 신고는 저장됐으니 기다리지 않는다
    void this.reportDiscordService.notifyReport(report);

    return { isReported: true, isAlreadyReported: false };
  }

  // 피드 · 편지가 담고 있는 기록. 첨부 파일은 R2 키만 남긴다 (파일 자체는 정리 크론이 지울 수 있다)
  private toRecordSnapshot(record: RecordEntity): ReportContentSnapshot {
    return {
      recordId: Number(record.id),
      text: record.text,
      music: {
        title: record.music.musicTitle,
        artist: record.music.musicArtist,
      },
      fileKeys: record.files.map((file) => file.fileKey),
    };
  }
}
