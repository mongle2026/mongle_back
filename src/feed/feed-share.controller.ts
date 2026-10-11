import { Controller, Get, Header, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedService } from './feed.service';

// 공유 링크로 여는 웹페이지. 앱 밖(브라우저 · 메신저 미리보기)에서 열리므로 로그인을 확인하지 않는다.
@Controller('feed')
export class FeedShareController {
  constructor(
    private readonly feedService: FeedService,
    private readonly configService: ConfigService,
  ) { }

  @Get('share/:feedId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getFeedSharePage(
    @Param('feedId') feedId: string,
  ) {
    const meta = await this.feedService.getFeedShareMeta(
      Number(feedId),
    );

    return this.createFeedShareHtml(feedId, meta);
  }

  private createFeedShareHtml(
    feedId: string,
    meta: {
      title: string;
      description: string;
      imageUrl: string | null;
      siteName: string;
    },
  ) {
    const title = this.escapeHtml(meta.title);
    const description = this.escapeHtml(meta.description);
    const siteName = this.escapeHtml(meta.siteName);
    const imageUrl = meta.imageUrl
      ? this.escapeHtml(meta.imageUrl)
      : null;

    // 앱 미설치 시 스토어 링크는 출시 전까지 비어있을 수 있으므로,
    // 값이 없으면 딥링크 실패 후에도 이 웹페이지에 그대로 머무른다.
    const appScheme =
      this.configService.get<string>('APP_SCHEME') ?? 'mongle';
    const iosStoreUrl =
      this.configService.get<string>('IOS_APP_STORE_URL') ?? '';
    const androidStoreUrl =
      this.configService.get<string>('ANDROID_PLAY_STORE_URL') ?? '';
    const deepLink = `${appScheme}://share?feedId=${encodeURIComponent(feedId)}`;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:site_name" content="${siteName}">
${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ''}
<title>${title}</title>
</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
<script>
(function () {
  var deepLink = ${JSON.stringify(deepLink)};
  var iosStoreUrl = ${JSON.stringify(iosStoreUrl)};
  var androidStoreUrl = ${JSON.stringify(androidStoreUrl)};

  var isAndroid = /Android/i.test(navigator.userAgent);
  var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (!isAndroid && !isIOS) {
    return;
  }

  var storeUrl = isAndroid ? androidStoreUrl : iosStoreUrl;

  var fallbackTimer = setTimeout(function () {
    if (storeUrl) {
      window.location.href = storeUrl;
    }
  }, 1500);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(fallbackTimer);
    }
  });

  window.location.href = deepLink;
})();
</script>
</body>
</html>`;
  }

  private escapeHtml(value: string) {
    const characters: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };

    return value.replace(
      /[&<>"']/g,
      character => characters[character],
    );
  }
}
