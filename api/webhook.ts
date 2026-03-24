import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "shingokumon@gmail.com";

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const conversationHistory: Record<
  string,
  Array<{ role: "user" | "assistant"; content: string }>
> = {};

const DEMO_SYSTEM_PROMPT = `あなたはMUSUBU（LINE×AI予約システム）のデモAIアシスタントです。
以下の3つのモードを状況に応じて使い分けてください。

━━━━━━━━━━━━━━━━━━
【モード1：デモ体験】
相手が予約の会話をしてきたとき
━━━━━━━━━━━━━━━━━━
ネイルサロン「サンプルネイル」のAI予約アシスタントとして対応する。

サロン設定：
- 営業時間：10:00〜20:00、定休日：火曜日
- メニュー：ジェルオフ¥3,300 / ワンカラー¥6,600 / デザインアート¥8,800〜
- 空き枠（固定）：13:00 / 15:00 / 17:00

予約確定時のフォーマット：
「ご予約が確定しました✨
📅 [日時]
💅 [メニュー]
💰 [金額]
前日にリマインドをお送りします！

---
💡 これはMUSUBUのAIデモです。
あなたのサロンにも同じ仕組みを導入できます👇
https://musubu-lp.vercel.app」

━━━━━━━━━━━━━━━━━━
【モード2：FAQ対応】
MUSUBUの料金・機能・仕組みを聞かれたとき
━━━━━━━━━━━━━━━━━━
以下の情報をもとに答える：
- 料金：月額¥6,980〜（初期費用¥0、いつでも解約OK）
- 対応業種：美容サロン・ネイルサロン・飲食店など
- 仕組み：LINE公式アカウントにAIを接続するだけ
- セットアップ：最短10分
- 競合との違い：AI自動応答（競合は手動確認が主流）
- 詳細はこちら：https://musubu-lp.vercel.app

━━━━━━━━━━━━━━━━━━
【モード3：商談】
「導入したい」「うちのサロンに使いたい」「どうすれば使える？」「申し込みたい」など
導入意向を示したとき
━━━━━━━━━━━━━━━━━━
以下の情報を自然な会話で収集する（一問一答で、一度に全部聞かない）：
1. サロン名（または屋号）
2. 連絡先（メールアドレスまたは電話番号）
3. 現在の予約管理方法（LINE手動 / 電話 / ホットペッパーなど）

全部揃ったら：
「ありがとうございます！✨
担当の久門（くもん）より24時間以内にご連絡します。
もう少しお待ちください🙏」

と返信し、最後に必ず以下の形式をメッセージ末尾に追加する：
LEAD_DETECTED:{"salon":"[サロン名]","contact":"[連絡先]","method":"[現在の予約方法]"}

━━━━━━━━━━━━━━━━━━
【共通ルール】
- LINEらしい自然で丁寧なトーン
- 返信は短く（3〜5行以内）
- 絵文字を適度に使う
- 押しつけがましくしない
━━━━━━━━━━━━━━━━━━`;

const WELCOME_MESSAGE = `こんにちは！✨
MUSUBUのAI予約デモへようこそ。

このアカウントでは、実際に「AIが予約を受け付ける体験」ができます。

📱 試し方はカンタン：
「明日の午後、空いてますか？」
と送るだけでOKです。

AIがリアルタイムで予約対応します。
ぜひ話しかけてみてください🤖`;

function verifySignature(body: string, signature: string): boolean {
  const hmac = crypto.createHmac("SHA256", LINE_CHANNEL_SECRET);
  const digest = hmac.update(body).digest("base64");
  return digest === signature;
}

async function replyToLine(replyToken: string, text: string): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

async function sendLeadEmail(leadData: {
  salon: string;
  contact: string;
  method: string;
}): Promise<void> {
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "MUSUBU Demo <onboarding@resend.dev>",
        to: [NOTIFY_EMAIL],
        subject: `🔥 商談リード獲得：${leadData.salon}`,
        html: `
          <h2>MUSUBUデモから商談リードが入りました！</h2>
          <table style="border-collapse: collapse; width: 100%;">
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">サロン名</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${leadData.salon}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">連絡先</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${leadData.contact}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">現在の予約管理</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${leadData.method}</td>
            </tr>
          </table>
          <p style="margin-top: 16px; color: #666;">24時間以内に連絡してください。</p>
        `,
      }),
    });
  } catch (error) {
    console.error("Failed to send lead email:", error);
  }
}

async function getAIReply(
  userId: string,
  userMessage: string
): Promise<{ replyText: string; leadData: { salon: string; contact: string; method: string } | null }> {
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }
  const history = conversationHistory[userId];
  history.push({ role: "user", content: userMessage });
  if (history.length > 20) history.splice(0, 2);

  // 現在日時を動的に注入
  const now = new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const systemWithDate = `現在の日時（日本時間）：${now}\n\n${DEMO_SYSTEM_PROMPT}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: systemWithDate,
    messages: history,
  });

  const fullMessage =
    response.content[0].type === "text" ? response.content[0].text : "";

  const leadMatch = fullMessage.match(/LEAD_DETECTED:(\{.*\})/);
  let leadData = null;
  let replyText = fullMessage;

  if (leadMatch) {
    try {
      leadData = JSON.parse(leadMatch[1]);
      replyText = fullMessage.replace(/LEAD_DETECTED:\{.*\}/, "").trim();
    } catch (e) {
      console.error("Failed to parse lead data:", e);
    }
  }

  history.push({ role: "assistant", content: replyText });
  return { replyText, leadData };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "MUSUBU Demo Webhook is running" });
  }

  const signature = req.headers["x-line-signature"] as string;
  const rawBody = JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type === "follow") {
      await replyToLine(event.replyToken, WELCOME_MESSAGE);
      continue;
    }

    if (event.type !== "message" || event.message.type !== "text") continue;

    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    try {
      const { replyText, leadData } = await getAIReply(userId, userMessage);
      await replyToLine(replyToken, replyText);
      if (leadData) await sendLeadEmail(leadData);
    } catch (error) {
      console.error("AI reply error:", error);
      await replyToLine(replyToken, "申し訳ありません、少し時間をおいて再度お試しください🙏");
    }
  }

  return res.status(200).json({ status: "ok" });
}