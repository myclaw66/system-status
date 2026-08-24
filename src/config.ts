import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface AppConfig {
  checkInterval: number;
  httpPort: number;
  feishu: {
    webhook: string;
    secret?: string;
    atMobiles?: string[];
    atAll?: boolean;
  };
  rules: any;
}

export function loadConfig(): AppConfig {
  const rulesPath = process.env.RULES_PATH || './config/rules.yaml';
  const rules = yaml.load(fs.readFileSync(rulesPath, 'utf8')) as any;

  return {
    checkInterval: Number(process.env.CHECK_INTERVAL || 60),
    httpPort: Number(process.env.HTTP_PORT || 8080),
    feishu: {
      webhook: process.env.FEISHU_WEBHOOK || '',
      secret: process.env.FEISHU_SECRET,
      atMobiles: process.env.FEISHU_AT_MOBILES?.split(',').filter(Boolean),
      atAll: process.env.FEISHU_AT_ALL === 'true',
    },
    rules,
  };
}
