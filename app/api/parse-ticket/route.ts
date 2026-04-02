import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server configuration error: missing API key" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Extract the base64 data and media type from the data URL
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json(
        { error: "Invalid image format" },
        { status: 400 }
      );
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
      {
        text: `Analyze this San Francisco parking ticket image. Extract the following information and return it as JSON only (no markdown, no explanation, no code fences):

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
    ]);

    const responseText = result.response.text();

    try {
      const parsed = JSON.parse(responseText);
      return NextResponse.json(parsed);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
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
