import { Test, TestingModule } from '@nestjs/testing';
import { FeedCommentService } from './feed-comment.service';

describe('FeedCommentService', () => {
  let service: FeedCommentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeedCommentService],
    }).compile();

    service = module.get<FeedCommentService>(FeedCommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
