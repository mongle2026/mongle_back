import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeedEntity } from '../feed/entities/feed.entity';
import { FeedCommentEntity } from './entities/feed-comment.entity';
import { CreateFeedCommentDto } from './dto/create-feed-comment.dto';
import { R2Service } from '../storage/r2.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationStatus } from '../notification/enums/notification.enum';

@Injectable()
export class FeedCommentService {
  constructor(
    @InjectRepository(FeedCommentEntity)
    private readonly feedCommentRepository: Repository<FeedCommentEntity>,

    @InjectRepository(FeedEntity)
    private readonly feedRepository: Repository<FeedEntity>,

    private readonly r2Service: R2Service,
    private readonly notificationService: NotificationService,
  ) { }

  async createComment(
    feedId: number,
    userId: number,
    dto: CreateFeedCommentDto,
  ) {
    this.validateId(feedId, 'feedId');
    this.validateId(userId, 'userId');

    const feed = await this.findFeedOrFail(feedId);

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
            });

      if (!rootComment) {
        throw new NotFoundException('원댓글을 찾을 수 없습니다.');
      }

      if (!isFeedAuthor && Number(rootComment.userId) !== Number(userId)) {
        throw new ForbiddenException(
          '내 댓글 묶음 안에서만 답글을 작성할 수 있습니다.',
        );
      }

      rootCommentId = rootId;
      replyToUserId = this.resolveReplyToUserId({
        requestedUserId: dto.replyToUserId,
        userId,
        feedAuthorId,
        rootCommentAuthorId: Number(rootComment.userId),
      });
    }

    const comment = this.feedCommentRepository.create({
      feedId,
      userId,
      content: dto.content,
      rootCommentId,
      replyToUserId,
    });

    const savedComment = await this.feedCommentRepository.save(comment);

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
    requestedUserId?: number;
    userId: number;
    feedAuthorId: number;
    rootCommentAuthorId: number;
  }) {
    const userId = Number(params.userId);
    const participants = [params.feedAuthorId, params.rootCommentAuthorId];
    const requested = params.requestedUserId
      ? Number(params.requestedUserId)
      : null;

    if (requested && requested !== userId && participants.includes(requested)) {
      return requested;
    }

    return (
      participants.find((participantId) => participantId !== userId) ?? null
    );
  }

  async getComments(feedId: number, userId: number) {
    this.validateId(feedId, 'feedId');
    this.validateId(userId, 'userId');

    const feed = await this.findFeedOrFail(feedId);

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

    const visibleComments = isFeedAuthor
      ? comments
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
        commentId: Number(comment.id),
        feedId: Number(comment.feedId),
        userId: Number(comment.userId),
        user: this.toCommentUser(comment.user),
        content: comment.content,
        rootCommentId: null,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
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

      if (!rootComment) {
        return;
      }

      rootComment.replies.push({
        commentId: Number(comment.id),
        feedId: Number(comment.feedId),
        userId: Number(comment.userId),
        user: this.toCommentUser(comment.user),
        content: comment.content,
        rootCommentId: rootId,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      });
    });

    return result;
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

  private async findFeedOrFail(feedId: number) {
    const feed = await this.feedRepository.findOne({
      where: {
        id: feedId,
      },
      relations: {
        record: true,
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
      userId: Number(comment.userId),
      content: comment.content,
      rootCommentId: comment.rootCommentId
        ? Number(comment.rootCommentId)
        : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  private toCommentUser(user: any) {
    if (!user) {
      return null;
    }

    return {
      userId: Number(user.id),
      nickname: user.nickname,
      userCode: user.userCode,
      hasProfileImage: !!user.imageMimeType,
      profileImageUrl: this.r2Service.getProfileImageUrl(
        user.id,
        user.imageMimeType,
        user.imageUpdatedAt,
      ),
    };
  }
}