export const CONTENT_LIMITS = {
  homeDefault: 9,
  homeMaximum: 24,
  archiveBatch: 24,
  adminBatch: 20,
  searchResults: 12,
  apiMaximum: 50,
} as const;

export const DEFAULT_SITE_SETTINGS = {
  id: 1,
  brandName: "星屿",
  brandLatin: "XINGYU",
  authorName: "星屿",
  avatarUrl: "/images/xingyu-avatar.jpg",
  tagline: "设计 · 技术 · 生活",
  description: "记录那些值得慢下来思考的设计、技术与生活片段。",
  heroLead: "在喧嚣之外，",
  heroTail: "留一座思考的岛。",
  homeSectionTitle: "最近在写",
  homeAboutTitle: "你好，这里是星屿。",
  homeAboutCopy: "一座关于设计、技术与生活的数字岛屿。希望每篇文章，都能给你留下一点值得带走的东西。",
  footerText: "保持好奇，持续创造。",
  seoTitle: "星屿 · 思考与创造",
  seoDescription: "星屿个人博客，记录设计、技术与生活。",
  homePostLimit: CONTENT_LIMITS.homeDefault,
} as const;

export const DEFAULT_ABOUT_PAGE = {
  slug: "about",
  eyebrow: "ABOUT · PERSONAL NOTES",
  title: "关于星屿，也关于为什么写作。",
  excerpt: "这里不是一份履历，也不是一个需要不断更新的个人橱窗。它更像一座安静的数字岛屿，用来保存那些值得慢一点想、认真一点写的东西。",
  content: `## 写作，是把模糊的感受变成可以带走的东西。

很多想法在脑海里显得理所当然，直到尝试把它写下来，才会发现其中仍有空白。写作迫使我放慢速度，重新检查自己的判断。

我不追求每天制造内容。更希望每一篇文章，都来自一次真实的观察、一次具体的实践，或者一个值得继续追问的问题。

> 不急着成为声音最大的人。先成为一个观察得足够仔细的人。

保持好奇，持续创造，也为生活保留空白。`,
} as const;

export const DEFAULT_CONNECT_PAGE = {
  slug: "connect",
  eyebrow: "XINGYU / MCP CONNECT",
  title: "把星屿，连接到你的 AI。",
  excerpt: "无论你的 AI 客户端支持 OAuth，还是需要手动填写 Token，都可以连接属于自己的星屿工作区。权限由你决定，连接由你管理。",
  content: "## 如何开始\n\n星屿通过标准 Streamable HTTP MCP 接入 AI 客户端，服务地址是 https://zhangwansen.click/mcp 。\n\n1. 如果客户端支持 OAuth，在客户端添加 MCP 地址，通过星屿账号登录并确认授权。\n2. 如果客户端需要手动 Bearer Token，登录星屿后打开「AI 连接」，为该客户端创建个人 Access Token。\n3. 在客户端配置中填写服务器地址及相应认证信息，先尝试读取有权限的工作区或文章。\n\n## 保护你的连接\n\n个人 Token 可以分别命名、独立设置读取/写作/发布权限，并设置有限期或永久有效。永久不代表不可撤销，撤销及账号停用都会令密钥失效。\n\n不要把 Token 放进公共代码仓库、聊天消息、公开日志或截图。使用单独的客户端凭据可以在设备遗失时只撤销该凭据，不影响其他连接。\n\n## 写作与发布\n\n推荐先搜索已有内容、创建草稿、确认变更后再写入。发布与撤回是独立敏感权限，不会因拥有普通读取或草稿权限而自动获得。\n\n需要管理令牌、已授权 OAuth 客户端或撤销连接，请打开登录后的「AI 连接」。",
} as const;

export function copyrightText(brandName: string, footerText: string) {
  return `© ${new Date().getFullYear()} ${brandName} · ${footerText}`;
}
