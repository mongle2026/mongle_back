import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  DiscordInteraction,
  DiscordInteractionService,
} from './discord-interaction.service';

// 디스코드 Developer Portal 의 Interactions Endpoint URL 에 이 주소를 넣는다.
// 로그인 토큰 대신 디스코드 서명으로 확인한다. 서명은 원본 body 로 확인해서 main.ts 에서 rawBody 를 켜 둔다
@Controller('discord')
export class DiscordInteractionController {
  constructor(
    private readonly discordInteractionService: DiscordInteractionService,
  ) {}

  @Post('interactions')
  @HttpCode(200)
  handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-signature-ed25519') signature?: string,
    @Headers('x-signature-timestamp') timestamp?: string,
  ) {
    if (
      !this.discordInteractionService.isValidSignature(
        request.rawBody,
        signature,
        timestamp,
      )
    ) {
      throw new UnauthorizedException('invalid request signature');
    }

    return this.discordInteractionService.handle(
      request.body as DiscordInteraction,
    );
  }
}
