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

@Injectable()
export class FeedCommentService {
  constructor(
    @InjectRepository(FeedCommentEntity)
    private readonly feedCommentRepository: Repository<FeedCommentEntity>,

    @InjectRepository(FeedEntity)
    private readonly feedRepository: Repository<FeedEntity>,
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

    let parentCommentId: number | null = null;
    let rootCommentId: number | null = null;

    if (dto.parentCommentId) {
      const parentComment = await this.feedCommentRepository.findOne({
        where: {
          id: dto.parentCommentId,
          feedId,
        },
      });

      if (!parentComment) {
        throw new NotFoundException('답글을 달 댓글을 찾을 수 없습니다.');
      }

      const rootId = parentComment.rootCommentId
        ? Number(parentComment.rootCommentId)
        : Number(parentComment.id);

      if (!isFeedAuthor) {
        const rootComment = await this.feedCommentRepository.findOne({
          where: {
            id: rootId,
            feedId,
          },
        });

        if (!rootComment) {
          throw new NotFoundException('원댓글을 찾을 수 없습니다.');
        }

        if (Number(rootComment.userId) !== Number(userId)) {
          throw new ForbiddenException(
            '내 댓글 묶음 안에서만 답글을 작성할 수 있습니다.',
          );
        }
      }

      parentCommentId = Number(parentComment.id);
      rootCommentId = rootId;
    }

    const comment = this.feedCommentRepository.create({
      feedId,
      userId,
      content: dto.content,
      parentCommentId,
      rootCommentId,
    });

    const savedComment = await this.feedCommentRepository.save(comment);

    return this.toCommentResponse(savedComment);
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
      if (comment.parentCommentId === null) {
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
      if (comment.parentCommentId !== null) {
        return;
      }

      const rootComment = {
        commentId: Number(comment.id),
        feedId: Number(comment.feedId),
        userId: Number(comment.userId),
        user: this.toCommentUser(comment.user),
        content: comment.content,
        parentCommentId: null,
        rootCommentId: null,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        replies: [],
      };

      rootCommentMap.set(Number(comment.id), rootComment);
      result.push(rootComment);
    });

    comments.forEach((comment) => {
      if (comment.parentCommentId === null) {
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
        parentCommentId: Number(comment.parentCommentId),
        rootCommentId: rootId,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      });
    });

    return result;
  }

  private getRootId(comment: FeedCommentEntity) {
    if (comment.rootCommentId) {
      return Number(comment.rootCommentId);
    }

    if (comment.parentCommentId) {
      return Number(comment.parentCommentId);
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
      parentCommentId: comment.parentCommentId
        ? Number(comment.parentCommentId)
        : null,
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
      profileImageUrl: user.imageMimeType
        ? `/user/${user.id}/profile-image`
        : null,
    };
  }
}