import nodemailer from "nodemailer";
import type { AppConfig } from "./config.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailService = {
  send(message: EmailMessage): Promise<void>;
};

type FetchLike = typeof fetch;

export function createEmailService(config: AppConfig, fetchImpl: FetchLike = fetch): EmailService {
  if (config.smartreadEmailProvider === "worker") {
    return createWorkerEmailService(config, fetchImpl);
  }
  return createSmtpEmailService(config);
}

function createSmtpEmailService(config: AppConfig): EmailService {
  const transporter = nodemailer.createTransport({
    host: config.smartreadSmtpHost,
    port: config.smartreadSmtpPort,
    secure: config.smartreadSmtpSecure,
    auth: {
      user: config.smartreadSmtpUser,
      pass: smtpPassword(config)
    }
  });

  return {
    async send(message) {
      assertSmtpConfigured(config);
      await transporter.sendMail({
        from: `智读 SmartRead <${config.smartreadSmtpFrom || config.smartreadSmtpUser}>`,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html
      });
    }
  };
}

function createWorkerEmailService(config: AppConfig, fetchImpl: FetchLike): EmailService {
  return {
    async send(message) {
      assertWorkerConfigured(config);
      const response = await fetchImpl(workerMailUrl(config), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [config.smartreadWorkerMailAuthHeader]: config.smartreadWorkerMailAuthToken
        },
        body: JSON.stringify({
          from_name: config.smartreadWorkerMailFromName,
          from_mail: config.smartreadWorkerMailFrom,
          to_mail: message.to,
          to_name: "",
          subject: message.subject,
          content: message.html || message.text,
          is_html: Boolean(message.html)
        })
      });

      if (!response.ok) {
        const error = new Error(`Worker 发信失败：${await summarizeWorkerError(response)}`) as Error & {
          statusCode?: number;
        };
        error.statusCode = 503;
        throw error;
      }
    }
  };
}

export function buildLoginCodeEmail(code: string): Pick<EmailMessage, "subject" | "text" | "html"> {
  const subject = "智读 SmartRead 登录验证码";
  const describedCode = describeCodeInChinese(code);
  const text = [
    `你的智读 SmartRead 登录验证码是：${code}`,
    `验证码逐位读作：${describedCode}`,
    "",
    "验证码 10 分钟内有效。若不是你本人操作，可以忽略这封邮件。"
  ].join("\n");
  const html = `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#172033">
      <p>你的智读 SmartRead 登录验证码是：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</p>
      <p>验证码逐位读作：<strong>${describedCode}</strong></p>
      <p>验证码 10 分钟内有效。若不是你本人操作，可以忽略这封邮件。</p>
    </div>`;
  return { subject, text, html };
}

function describeCodeInChinese(code: string): string {
  const digitMap: Record<string, string> = {
    "0": "零",
    "1": "一",
    "2": "二",
    "3": "三",
    "4": "四",
    "5": "五",
    "6": "六",
    "7": "七",
    "8": "八",
    "9": "九"
  };
  return code
    .split("")
    .map((digit, index) => `第 ${index + 1} 位 ${digitMap[digit] || digit}`)
    .join("，");
}

function assertSmtpConfigured(config: AppConfig) {
  if (!config.smartreadSmtpHost || !config.smartreadSmtpUser || !config.smartreadSmtpPass) {
    const error = new Error("邮件服务未配置") as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }
}

function assertWorkerConfigured(config: AppConfig) {
  if (
    !config.smartreadWorkerMailBaseUrl ||
    !config.smartreadWorkerMailAuthHeader ||
    !config.smartreadWorkerMailAuthToken ||
    !config.smartreadWorkerMailFrom
  ) {
    const error = new Error("邮件服务未配置") as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }
}

function workerMailUrl(config: AppConfig): string {
  const base = config.smartreadWorkerMailBaseUrl.endsWith("/")
    ? config.smartreadWorkerMailBaseUrl
    : `${config.smartreadWorkerMailBaseUrl}/`;
  const path = config.smartreadWorkerMailPath.replace(/^\//, "");
  return new URL(path, base).toString();
}

async function summarizeWorkerError(response: Response): Promise<string> {
  const text = (await response.text()).replace(/\s+/g, " ").trim();
  if (!text) return `HTTP ${response.status}`;
  return `${response.status} ${text.slice(0, 160)}`;
}

function smtpPassword(config: AppConfig): string {
  const pass = config.smartreadSmtpPass || "";
  if (config.smartreadSmtpHost.toLowerCase().includes("gmail.com")) {
    return pass.replace(/\s+/g, "");
  }
  return pass;
}
