import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { prompt, role } = body;

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing AI provider key" },
      { status: 500 }
    );
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-sonnet",
      messages: [
        {
          role: "system",
          content: `You are Klyn ${role} agent. Generate production quality output.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json();

  return NextResponse.json({
    content: data.choices?.[0]?.message?.content || "",
    model: data.model,
  });
}
