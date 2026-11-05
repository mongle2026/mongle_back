import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FeedEntity } from '../feed/entities/feed.entity';
import { FeedCommentEntity } from './entities/feed-comment.entity';
import { CreateFeedCommentDto } from './dto/create-feed-comment.dto';
import { R2Service } from '../storage/r2.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationStatus } from '../notification/enums/notification.enum';
import { UserEntity } from '../user/entities/user.entity';
import { getDisplayNickname, isWithdrawnUser } from '../user/withdrawn-user';
import { BlockService } from '../block/block.service';

@Injectable()
export class FeedCommentService {
  constructor(
    @InjectRepository(FeedCommentEntity)
    private readonly feedCommentRepository: Repository<FeedCommentEntity>,

    @InjectRepository(FeedEntity)
    private readonly feedRepository: Repository<FeedEntity>,

    private readonly r2Service: R2Service,
    private readonly notificationService: NotificationService,
    private readonly blockService: BlockService,
  ) { }

  async createComment(
    feedId: number,
    userId: number,
    dto: CreateFeedCommentDto,
  ) {
    this.validateId(feedId, 'feedId');
    this.validateId(userId, 'userId');

    const { feed, blockedUserIds } = await this.findVisibleFeedOrFail(
      feedId,
      userId,
    );

    // 운영자가 가린 글에는 댓글을 달 수 없다
    if (feed.blindedAt) {
      throw new NotFoundException('피드를 찾을 수 없습니다.');
    }

    const feedAuthorId = Number(feed.record.userId);
    const isFeedAuthor = feedAuthorId === Number(userId);

    let rootCommentId: number | null = null;
    let replyToUserId: number | null = null;

    if (dto.rootCommentId) {
      const target = await this.feedCommentRepository.findOne({
        where: {
          id: dto.rootCommentId,
          feedId,
        },
        relations: {
          user: true,
        },
      });

      if (!target) {
        throw new NotFoundException('답글을 달 댓글을 찾을 수 없습니다.');
      }

      // 답글 id 가 넘어와도 그 원댓글로 묶는다 (답글의 답글은 만들지 않는다)
      const rootId = target.rootCommentId
        ? Number(target.rootCommentId)
        : Number(target.id);

      const rootComment =
        rootId === Number(target.id)
          ? target
          : await this.feedCommentRepository.findOne({
              where: {
                id: rootId,
                feedId,
              },
              relations: {
                user: true,
              },
            });

      if (!rootComment) {
        throw new NotFoundException('원댓글을 찾을 수 없습니다.');
      }

      // 운영자가 가린 원댓글에는 답글을 달 수 없다
      if (rootComment.blindedAt) {
        throw new NotFoundException('답글을 달 댓글을 찾을 수 없습니다.');
      }

      // 글 작성자는 차단 사이가 된 사람의 댓글 묶음을 볼 수 없으니 답글도 달 수 없다
      if (blockedUserIds.has(Number(rootComment.userId))) {
        throw new NotFoundException('답글을 달 댓글을 찾을 수 없습니다.');
      }

      if (!isFeedAuthor && Number(rootComment.userId) !== Number(userId)) {
        throw new ForbiddenException(
          '내 댓글 묶음 안에서만 답글을 작성할 수 있습니다.',
        );
      }

      rootCommentId = rootId;
      replyToUserId = this.resolveReplyToUserId({
        requestedPublicId: dto.replyToUserId,
        userId,
        participants: [feed.record.user, rootComment.user],
      });
    }

    const comment = this.feedCommentRepository.create({
      feedId,
      userId,
      content: dto.content,
      rootCommentId,
      replyToUserId,
    });

    // INSERT 한 번뿐이라 트랜잭션으로 감쌀 필요가 없다 (START/COMMIT 왕복 생략)
    const savedComment = await this.feedCommentRepository.save(comment, {
      transaction: false,
    });

    // 원댓글은 글 작성자에게, 답글은 답글 대상으로 선택한 사람에게만 알린다
    const notifyUserId = rootCommentId ? replyToUserId : feedAuthorId;

    if (notifyUserId && notifyUserId !== Number(userId)) {
      void this.notificationService.notify({
        userId: notifyUserId,
        status: rootCommentId
          ? NotificationStatus.REPLY
          : NotificationStatus.COMMENT,
        actorId: Number(userId),
        feedId: Number(feedId),
        commentId: Number(savedComment.id),
        content: savedComment.content,
      });
    }

    return this.toCommentResponse(savedComment);
  }

  /*
   * 댓글 묶음 안에서는 글 작성자와 원댓글 작성자 둘만 답글을 단다.
   * 요청한 대상이 둘 중 나 아닌 사람이면 그대로 쓰고,
   * 비어 있거나 올바르지 않으면 묶음의 상대방으로 정한다. (글 작성자가 자기 글에 단 묶음이면 없음)
   */
  private resolveReplyToUserId(params: {
    requestedPublicId?: string;
    userId: number;
    participants: UserEntity[];
  }) {
    const others = params.participants.filter(
      (participant) => Number(participant.id) !== Number(params.userId),
    );
    const target =
      others.find(
        (participant) => participant.publicId === params.requestedPublicId,
      ) ?? others[0];

    return target ? Number(target.id) : null;
  }

  async getComments(feedId: number, userId: number) {
    this.validateId(feedId, 'feedId');
    this.validateId(userId, 'userId');

    const { feed, blockedUserIds } = await this.findVisibleFeedOrFail(
      feedId,
      userId,
    );

    const feedAuthorId = Number(feed.record.userId);
    const isFeedAuthor = feedAuthorId === Number(userId);

    const comments = await this.feedCommentRepository.find({
      where: {
        feedId,
      },
      relations: {
        user: true,
      },
      order: {
        createdAt: 'ASC',
        id: 'ASC',
      },
    });

    // 차단 사이인 사람의 댓글은 뺀다. 원댓글이 빠지면 그 묶음의 답글도 함께 빠진다 (toCommentGroups)
    const visibleComments = isFeedAuthor
      ? comments.filter(
          (comment) => !blockedUserIds.has(Number(comment.userId)),
        )
      : this.filterVisibleCommentsForUser(comments, userId, feedAuthorId);

    return this.toCommentGroups(visibleComments);
  }

  async deleteComment(feedId: number, commentId: number, userId: number) {
    this.validateId(feedId, 'feedId');
    this.validateId(commentId, 'commentId');
    this.validateId(userId, 'userId');

    await this.findMyCommentOrFail(feedId, commentId, userId);

    await this.feedCommentRepository.softDelete({
      id: commentId,
      feedId,
    });

    return {
      message: '댓글이 삭제되었습니다.',
    };
  }

  async purgeDeletedComments(days = 30, limit = 100) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.feedCommentRepository.manager.transaction(async (manager) => {
      const comments = await manager
        .getRepository(FeedCommentEntity)
        .createQueryBuilder('comment')
        .withDeleted()
        .select(['comment.id'])
        .where('comment.deletedAt IS NOT NULL')
        .andWhere('comment.deletedAt <= :cutoff', { cutoff })
        .orderBy('comment.deletedAt', 'ASC')
        .limit(limit)
        .getMany();

      if (comments.length === 0) {
        return {
          message: '물리 삭제할 댓글이 없습니다.',
          targetCount: 0,
          deletedCommentCount: 0,
        };
      }

      const commentIds = comments.map((comment) => Number(comment.id));

      /*
       * 원댓글만 지우면 FK(SET NULL) 때문에 답글이 원댓글로 바뀌어 다시 보입니다.
       * 원댓글이 삭제된 답글은 이미 목록에서 빠져 있으므로 함께 지웁니다.
       */
      const replyDeleteResult = await manager.delete(FeedCommentEntity, {
        rootCommentId: In(commentIds),
      });

      const commentDeleteResult = await manager.delete(FeedCommentEntity, {
        id: In(commentIds),
      });

      return {
        message: '삭제 보관 기간이 지난 댓글이 물리 삭제되었습니다.',
        targetCount: comments.length,
        deletedCommentCount:
          (replyDeleteResult.affected ?? 0) +
          (commentDeleteResult.affected ?? 0),
      };
    });
  }

  private filterVisibleCommentsForUser(
    comments: FeedCommentEntity[],
    userId: number,
    feedAuthorId: number,
  ) {
    const myRootCommentIds = new Set<number>();

    comments.forEach((comment) => {
      const commentUserId = Number(comment.userId);

      if (commentUserId !== Number(userId)) {
        return;
      }

      // 내가 쓴 원댓글만 하나의 대화 묶음으로 인정
      if (this.isRootComment(comment)) {
        myRootCommentIds.add(Number(comment.id));
      }
    });

    return comments.filter((comment) => {
      const rootId = this.getRootId(comment);

      if (!myRootCommentIds.has(rootId)) {
        return false;
      }

      const commentUserId = Number(comment.userId);

      // 내 원댓글 묶음 안에서
      // 나와 글 작성자가 쓴 댓글만 보임
      return (
        commentUserId === Number(userId) ||
        commentUserId === Number(feedAuthorId)
      );
    });
  }

  private toCommentGroups(comments: FeedCommentEntity[]) {
    const rootCommentMap = new Map<number, any>();
    const result: any[] = [];

    comments.forEach((comment) => {
      if (!this.isRootComment(comment)) {
        return;
      }

      const rootComment = {
        ...this.toCommentItem(comment),
        rootCommentId: null,
        replies: [],
      };

      rootCommentMap.set(Number(comment.id), rootComment);
      result.push(rootComment);
    });

    comments.forEach((comment) => {
      if (this.isRootComment(comment)) {
        return;
      }

      const rootId = this.getRootId(comment);
      const rootComment = rootCommentMap.get(rootId);

      // 원댓글이 가려졌으면 삭제됐을 때처럼 그 묶음의 답글은 보여주지 않는다
      if (!rootComment || rootComment.isBlinded) {
        return;
      }

      rootComment.replies.push({
        ...this.toCommentItem(comment),
        rootCommentId: rootId,
      });
    });

    return result;
  }

  /*
   * 댓글 목록의 댓글 하나 (원댓글 · 답글 공용).
   * 운영자가 가린 댓글은 내용 · 작성자를 비우고 isBlinded 만 알려준다 (작성자 본인에게도 같다)
   */
  private toCommentItem(comment: FeedCommentEntity) {
    const isBlinded = !!comment.blindedAt;

    return {
      commentId: Number(comment.id),
      feedId: Number(comment.feedId),
      isBlinded,
      userId: isBlinded ? null : (comment.user?.publicId ?? null),
      user: isBlinded ? null : this.toCommentUser(comment.user),
      content: isBlinded ? null : comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  private isRootComment(comment: FeedCommentEntity) {
    return !comment.rootCommentId;
  }

  private getRootId(comment: FeedCommentEntity) {
    if (comment.rootCommentId) {
      return Number(comment.rootCommentId);
    }

    return Number(comment.id);
  }

  /*
   * 댓글을 보거나 달 글. 글 작성자와 차단 사이(누가 차단했든)면 없는 글로 본다.
   * 차단 사이인 사람 목록도 같이 돌려줘서 댓글을 거를 때 쓴다. 두 조회는 동시에 한다.
   */
  private async findVisibleFeedOrFail(feedId: number, userId: number) {
    const [feed, blockedUserIds] = await Promise.all([
      this.findFeedOrFail(feedId),
      this.blockService.getBlockedPairUserIds(userId),
    ]);
    const blockedUserIdSet = new Set(blockedUserIds);

    if (blockedUserIdSet.has(Number(feed.record.userId))) {
      throw new NotFoundException('피드를 찾을 수 없습니다.');
    }

    return { feed, blockedUserIds: blockedUserIdSet };
  }

  private async findFeedOrFail(feedId: number) {
    const feed = await this.feedRepository.findOne({
      where: {
        id: feedId,
      },
      relations: {
        record: {
          user: true,
        },
      },
    });

    if (!feed) {
      throw new NotFoundException('피드를 찾을 수 없습니다.');
    }

    return feed;
  }

  private async findMyCommentOrFail(
    feedId: number,
    commentId: number,
    userId: number,
  ) {
    const comment = await this.feedCommentRepository.findOne({
      where: {
        id: commentId,
        feedId,
      },
    });

    if (!comment) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }

    if (Number(comment.userId) !== Number(userId)) {
      throw new ForbiddenException('내가 작성한 댓글만 수정하거나 삭제할 수 있습니다.');
    }

    return comment;
  }

  private validateId(value: number, name: string) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${name} 값이 올바르지 않습니다.`);
    }
  }

  private toCommentResponse(comment: FeedCommentEntity) {
    return {
      commentId: Number(comment.id),
      feedId: Number(comment.feedId),
      content: comment.content,
      rootCommentId: comment.rootCommentId
        ? Number(comment.rootCommentId)
        : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  private toCommentUser(user: UserEntity | null | undefined) {
    if (!user) {
      return null;
    }

    return {
      userId: user.publicId,
      nickname: getDisplayNickname(user),
      userCode: user.userCode,
      hasProfileImage: !!user.profileImageKey,
      profileImageUrl: this.r2Service.getProfileImageUrl(user),
      isWithdrawn: isWithdrawnUser(user),
    };
  }
}