import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server configuration error: missing API key" },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    // Extract the base64 data and media type from the data URL
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json(
        { error: "Invalid image format" },
        { status: 400 }
      );
    }

    const mediaType = match[1] as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";
    const base64Data = match[2];

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: `Analyze this San Francisco parking ticket image. Extract the following information and return it as JSON only (no markdown, no explanation):

{
  "citationNumber": "the citation/ticket number",
  "violationDate": "date of violation",
  "violationCode": "violation code or description",
  "location": "location of violation",
  "vehiclePlate": "license plate number",
  "fineAmount": "fine amount if visible"
}

If any field is not visible or readable, use an empty string for that field. Return ONLY the JSON object.`,
            },
          ],
        },
      ],
    });

    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return NextResponse.json(
        { error: "Failed to analyze image" },
        { status: 500 }
      );
    }

    try {
      const parsed = JSON.parse(textContent.text);
      return NextResponse.json(parsed);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return NextResponse.json(parsed);
      }
      return NextResponse.json(
        { error: "Failed to parse ticket data" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Parse ticket error:", error);
    return NextResponse.json(
      { error: "Failed to process ticket image" },
      { status: 500 }
    );
  }
}
