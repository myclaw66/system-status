import * as crypto from 'crypto';
import axios from 'axios';

export interface FeishuConfig {
  webhook: string;
  secret?: string;
  atMobiles?: string[];
  atAll?: boolean;
}

export class FeishuBot {
  constructor(private cfg: FeishuConfig) {}

  private genSign(timestamp: number): string {
    if (!this.cfg.secret) return '';
    const stringToSign = `${timestamp}\n${this.cfg.secret}`;
    return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
  }

  private async send(payload: any) {
    if (!this.cfg.webhook) {
      console.warn('[feishu] webhook not set, skip');
      return;
    }
    const ts = Math.floor(Date.now() / 1000);
    const sign = this.genSign(ts);
    const body = { timestamp: String(ts), sign, ...payload };
    try {
      const { data } = await axios.post(this.cfg.webhook, body, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      });
      if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg}`);
      return data;
    } catch (e: any) {
      console.error('[feishu] send failed:', e.message);
      throw e;
    }
  }

  async text(content: string) {
    return this.send({
      msg_type: 'text',
      content: { text: content },
      at: { atMobiles: this.cfg.atMobiles ?? [], atAll: this.cfg.atAll ?? false },
    });
  }

  async card(opts: {
    title: string;
    level: 'info' | 'warning' | 'danger';
    fields: Array<{ label: string; value: string }>;
    remark?: string;
  }) {
    const colorMap = { info: 'blue', warning: 'orange', danger: 'red' } as const;
    return this.send({
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: opts.title },
          template: colorMap[opts.level],
        },
        elements: [
          {
            tag: 'div',
            fields: opts.fields.map(f => ({
              is_short: true,
              text: { tag: 'lark_md', content: `**${f.label}**\n${f.value}` },
            })),
          },
          { tag: 'hr' },
          {
            tag: 'note',
            elements: [
              {
                tag: 'plain_text',
                content: opts.remark ?? `⏰ ${new Date().toLocaleString('zh-CN')}`,
              },
            ],
          },
        ],
      },
    });
  }
}
