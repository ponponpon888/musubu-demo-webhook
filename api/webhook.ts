import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// 会話履歴をメモリで保持（デモ用・簡易版）
const conversationHistory: Record<
  string,
  Array<{ role: "user" | "assistant"; content: string }>
> = {};

const DEMO_SYSTEM_PROMPT = `あなたはネイルサロン「サンプルネイル」のAI予約アシスタントです。
MUSUBUというLINE×AI予約システムのデモとして動いています。

【サロン設定】
サロン名：サンプルネイル
営業時間：10:00〜20:00
定休日：火曜日
メニュー：
  - ジェルオフ ¥3,300（約30分）
  - ワンカラー ¥6,600（約60分）
  - デザインアート ¥8,800〜（約90分）

【空き枠（固定）】
今日・明日ともに以下が空いています：
  - 13:00〜
  - 15:00〜
  - 17:00〜

【応答ルール】
- LINEらしい自然で丁寧なトーンで返す
- 返信は短く（3〜5行以内）
- 予約の流れ：空き確認 → メニュー確認 → 予約確定
- 予約確定時は以下の形式で締める：

「ご予約が確定しました✨
📅 [日時]
💅 [メニュー]
💰 [金額]
前日にリマインドをお送りします！」

【重要】
これはMUSUBUのAIデモです。実際の予約は確定しません。
会話の最後（予約確定後）に一度だけ以下を添えてください：
「---
💡 これはMUSUBUのAIデモです。
あなたのサロンにも同じ仕組みを導入できます。
👉 musubu-lp.vercel.app」`;

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

async function getAIReply(
  userId: string,
  userMessage: string
): Promise<string> {
  // 会話履歴を取得（最大10往復）
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }
  const history = conversationHistory[userId];

  history.push({ role: "user", content: userMessage });

  // 10往復を超えたら古いものを削除
  if (history.length > 20) {
    history.splice(0, 2);
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: DEMO_SYSTEM_PROMPT,
    messages: history,
  });

  const assistantMessage =
    response.content[0].type === "text" ? response.content[0].text : "";

  history.push({ role: "assistant", content: assistantMessage });

  return assistantMessage;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "MUSUBU Demo Webhook is running" });
  }

  // 署名検証
  const signature = req.headers["x-line-signature"] as string;
  const rawBody = JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") {
      // テキスト以外（スタンプ等）への対応
      if (event.type === "follow") {
        // 友だち追加時のウェルカムメッセージ
        await replyToLine(
          event.replyToken,
          `こんにちは！🌸
MUSUBUのAIデモへようこそ。

私はネイルサロン「サンプルネイル」のAI予約アシスタントです。
実際に予約の会話を体験してみてください。

例えば「明日の午後、空いてますか？」と送ってみてください✨`
        );
      }
      continue;
    }

    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    try {
      const aiReply = await getAIReply(userId, userMessage);
      await replyToLine(replyToken, aiReply);
    } catch (error) {
      console.error("AI reply error:", error);
      await replyToLine(
        replyToken,
        "申し訳ありません、少し時間をおいて再度お試しください🙏"
      );
    }
  }

  return res.status(200).json({ status: "ok" });
}
