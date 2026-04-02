import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest } from "next/server";
import * as cheerio from "cheerio";

const SFMTA_BASE = "https://prdwmq.etimspayments.com";
const DISPUTE_PAGE = `${SFMTA_BASE}/pbw/include/sanfrancisco/dispute_request.jsp`;
const DISPUTE_ACTION = `${SFMTA_BASE}/pbw/onlineDisputeAction.doh`;
const CAPTCHA_URL = `${SFMTA_BASE}/pbw/CaptchaServlet.doh`;

function sendEvent(
  controller: ReadableStreamDefaultController,
  data: Record<string, unknown>
) {
  controller.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
  );
}

function extractCookies(response: Response): string[] {
  const cookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const cookie = value.split(";")[0];
      cookies.push(cookie);
    }
  });
  return cookies;
}

function mergeCookies(existing: string[], incoming: string[]): string[] {
  const map = new Map<string, string>();
  for (const c of existing) {
    const [name] = c.split("=");
    map.set(name, c);
  }
  for (const c of incoming) {
    const [name] = c.split("=");
    map.set(name, c);
  }
  return Array.from(map.values());
}

export async function POST(req: NextRequest) {
  const { citationNumber, reason, email, phone } = await req.json();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Server configuration error: missing API key" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const stream = new ReadableStream({
    async start(controller) {
      let cookies: string[] = [];

      try {
        // Step 0: Access the dispute portal
        sendEvent(controller, { type: "step", stepIndex: 0 });

        const pageRes = await fetch(DISPUTE_PAGE, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        cookies = extractCookies(pageRes);
        const pageHtml = await pageRes.text();
        const $ = cheerio.load(pageHtml);

        // Find the CAPTCHA field name (it's dynamically generated)
        const captchaInput = $('input[maxlength="8"][size="10"]');
        const captchaFieldName = captchaInput.attr("name") || captchaInput.attr("id");

        if (!captchaFieldName) {
          sendEvent(controller, {
            type: "error",
            stepIndex: 0,
            message:
              "Could not find CAPTCHA field on the dispute page. The SFMTA site may be temporarily unavailable.",
          });
          controller.close();
          return;
        }

        // Step 1: Solve CAPTCHA
        sendEvent(controller, { type: "step", stepIndex: 1 });

        let captchaSolved = false;
        let captchaText = "";
        let attempts = 0;
        const maxAttempts = 3;

        while (!captchaSolved && attempts < maxAttempts) {
          attempts++;

          // Fetch CAPTCHA image
          const captchaRes = await fetch(
            `${CAPTCHA_URL}?${Date.now()}`,
            {
              headers: {
                Cookie: cookies.join("; "),
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Referer: DISPUTE_PAGE,
              },
            }
          );

          const newCookies = extractCookies(captchaRes);
          cookies = mergeCookies(cookies, newCookies);

          const captchaBuffer = await captchaRes.arrayBuffer();
          const captchaBase64 = Buffer.from(captchaBuffer).toString("base64");
          const captchaMimeType =
            captchaRes.headers.get("content-type") || "image/jpeg";

          // Solve with Gemini Vision
          const solveResult = await model.generateContent([
            {
              inlineData: {
                mimeType: captchaMimeType,
                data: captchaBase64,
              },
            },
            {
              text: "Read the text in this CAPTCHA image. Return ONLY the characters you see, nothing else. No quotes, no explanation, just the exact characters.",
            },
          ]);

          const solvedText = solveResult.response.text().trim();
          if (solvedText.length >= 4 && solvedText.length <= 8) {
            captchaText = solvedText;
            captchaSolved = true;
          }
        }

        if (!captchaSolved) {
          sendEvent(controller, {
            type: "error",
            stepIndex: 1,
            message: "Failed to solve CAPTCHA after multiple attempts. Please try again.",
          });
          controller.close();
          return;
        }

        // Step 2: Submit citation number with CAPTCHA
        sendEvent(controller, { type: "step", stepIndex: 2 });

        const formData = new URLSearchParams();
        formData.append("clientcode", "19");
        formData.append("requestType", "submit");
        formData.append("clientAccount", "5");
        formData.append("actionType", "I");
        formData.append("ticket", citationNumber);
        formData.append(captchaFieldName, captchaText);
        formData.append("submit", "    Next    ");

        const submitRes = await fetch(DISPUTE_ACTION, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookies.join("; "),
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: DISPUTE_PAGE,
            Origin: SFMTA_BASE,
          },
          body: formData.toString(),
          redirect: "manual",
        });

        const step2Cookies = extractCookies(submitRes);
        cookies = mergeCookies(cookies, step2Cookies);

        let step2Html: string;
        if (submitRes.status >= 300 && submitRes.status < 400) {
          const redirectUrl = submitRes.headers.get("location");
          const fullUrl = redirectUrl?.startsWith("http")
            ? redirectUrl
            : `${SFMTA_BASE}${redirectUrl}`;
          const redirectRes = await fetch(fullUrl, {
            headers: {
              Cookie: cookies.join("; "),
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          });
          const redirectCookies = extractCookies(redirectRes);
          cookies = mergeCookies(cookies, redirectCookies);
          step2Html = await redirectRes.text();
        } else {
          step2Html = await submitRes.text();
        }

        // Check for errors in the response
        const $step2 = cheerio.load(step2Html);
        const errorText =
          $step2(".error").text().trim() ||
          $step2(".errormsg").text().trim() ||
          $step2('[class*="error"]').text().trim();

        if (
          errorText &&
          (errorText.toLowerCase().includes("invalid") ||
            errorText.toLowerCase().includes("incorrect") ||
            errorText.toLowerCase().includes("not found"))
        ) {
          sendEvent(controller, {
            type: "error",
            stepIndex: 2,
            message: `SFMTA returned an error: ${errorText}`,
          });
          controller.close();
          return;
        }

        // Step 3: Enter dispute details
        sendEvent(controller, { type: "step", stepIndex: 3 });

        const step2Form = $step2("form");
        if (step2Form.length > 0) {
          const step2Action =
            step2Form.attr("action") || DISPUTE_ACTION;
          const fullAction = step2Action.startsWith("http")
            ? step2Action
            : `${SFMTA_BASE}${step2Action}`;

          const step2FormData = new URLSearchParams();
          step2Form.find('input[type="hidden"]').each((_, el) => {
            const name = $step2(el).attr("name");
            const value = $step2(el).attr("value") || "";
            if (name) step2FormData.append(name, value);
          });

          step2Form.find("textarea").each((_, el) => {
            const name = $step2(el).attr("name");
            if (name) step2FormData.append(name, reason);
          });

          step2Form.find("select").each((_, el) => {
            const name = $step2(el).attr("name");
            if (name) {
              const options = $step2(el).find("option");
              let selectedValue = "";
              options.each((_, opt) => {
                const val = $step2(opt).attr("value") || "";
                const text = $step2(opt).text().toLowerCase();
                if (!selectedValue && val && text.includes("other")) {
                  selectedValue = val;
                }
              });
              if (!selectedValue) {
                options.each((_, opt) => {
                  const val = $step2(opt).attr("value") || "";
                  if (!selectedValue && val) selectedValue = val;
                });
              }
              if (name) step2FormData.append(name, selectedValue);
            }
          });

          step2Form
            .find('input[type="text"], input[type="email"], input[type="tel"]')
            .each((_, el) => {
              const name = ($step2(el).attr("name") || "").toLowerCase();
              const id = ($step2(el).attr("id") || "").toLowerCase();
              const fieldKey = name + id;

              if (fieldKey.includes("email")) {
                step2FormData.append($step2(el).attr("name") || "", email);
              } else if (
                fieldKey.includes("phone") ||
                fieldKey.includes("tel")
              ) {
                step2FormData.append($step2(el).attr("name") || "", phone);
              }
            });

          const submitBtn = step2Form.find(
            'input[type="submit"], button[type="submit"]'
          );
          if (submitBtn.length > 0) {
            const btnName = submitBtn.first().attr("name");
            const btnValue = submitBtn.first().attr("value") || "";
            if (btnName) step2FormData.append(btnName, btnValue);
          }

          const step3Res = await fetch(fullAction, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Cookie: cookies.join("; "),
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Referer: DISPUTE_PAGE,
              Origin: SFMTA_BASE,
            },
            body: step2FormData.toString(),
            redirect: "manual",
          });

          const step3Cookies = extractCookies(step3Res);
          cookies = mergeCookies(cookies, step3Cookies);

          // Step 4: Contact information
          sendEvent(controller, { type: "step", stepIndex: 4 });

          let step3Html: string;
          if (step3Res.status >= 300 && step3Res.status < 400) {
            const redirectUrl = step3Res.headers.get("location");
            const fullUrl = redirectUrl?.startsWith("http")
              ? redirectUrl
              : `${SFMTA_BASE}${redirectUrl}`;
            const redirectRes = await fetch(fullUrl, {
              headers: {
                Cookie: cookies.join("; "),
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
            });
            step3Html = await redirectRes.text();
          } else {
            step3Html = await step3Res.text();
          }

          const $step3 = cheerio.load(step3Html);
          const step3Form = $step3("form");

          if (step3Form.length > 0) {
            const step3Action =
              step3Form.attr("action") || DISPUTE_ACTION;
            const fullStep3Action = step3Action.startsWith("http")
              ? step3Action
              : `${SFMTA_BASE}${step3Action}`;

            const step3FormData = new URLSearchParams();

            step3Form.find('input[type="hidden"]').each((_, el) => {
              const name = $step3(el).attr("name");
              const value = $step3(el).attr("value") || "";
              if (name) step3FormData.append(name, value);
            });

            step3Form
              .find('input[type="text"], input[type="email"], input[type="tel"]')
              .each((_, el) => {
                const name = ($step3(el).attr("name") || "").toLowerCase();
                const id = ($step3(el).attr("id") || "").toLowerCase();
                const fieldKey = name + id;

                if (fieldKey.includes("email")) {
                  step3FormData.append($step3(el).attr("name") || "", email);
                } else if (
                  fieldKey.includes("phone") ||
                  fieldKey.includes("tel")
                ) {
                  step3FormData.append($step3(el).attr("name") || "", phone);
                } else if (fieldKey.includes("reason") || fieldKey.includes("comment") || fieldKey.includes("dispute")) {
                  step3FormData.append($step3(el).attr("name") || "", reason);
                }
              });

            step3Form.find("textarea").each((_, el) => {
              const name = $step3(el).attr("name");
              if (name) step3FormData.append(name, reason);
            });

            step3Form.find("select").each((_, el) => {
              const name = $step3(el).attr("name");
              if (name) {
                const options = $step3(el).find("option");
                let selectedValue = "";
                options.each((_, opt) => {
                  const val = $step3(opt).attr("value") || "";
                  if (!selectedValue && val) selectedValue = val;
                });
                step3FormData.append(name, selectedValue);
              }
            });

            const submitBtn3 = step3Form.find(
              'input[type="submit"], button[type="submit"]'
            );
            if (submitBtn3.length > 0) {
              const btnName = submitBtn3.first().attr("name");
              const btnValue = submitBtn3.first().attr("value") || "";
              if (btnName) step3FormData.append(btnName, btnValue);
            }

            const step4Res = await fetch(fullStep3Action, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Cookie: cookies.join("; "),
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Referer: DISPUTE_PAGE,
                Origin: SFMTA_BASE,
              },
              body: step3FormData.toString(),
              redirect: "manual",
            });

            const step4Cookies = extractCookies(step4Res);
            cookies = mergeCookies(cookies, step4Cookies);

            // Step 5: Finalize
            sendEvent(controller, { type: "step", stepIndex: 5 });

            let step4Html: string;
            if (step4Res.status >= 300 && step4Res.status < 400) {
              const redirectUrl = step4Res.headers.get("location");
              const fullUrl = redirectUrl?.startsWith("http")
                ? redirectUrl
                : `${SFMTA_BASE}${redirectUrl}`;
              const redirectRes = await fetch(fullUrl, {
                headers: {
                  Cookie: cookies.join("; "),
                  "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
              });
              step4Html = await redirectRes.text();
            } else {
              step4Html = await step4Res.text();
            }

            const $step4 = cheerio.load(step4Html);
            const step4Form = $step4("form");

            if (step4Form.length > 0) {
              const step4Action = step4Form.attr("action") || DISPUTE_ACTION;
              const fullStep4Action = step4Action.startsWith("http")
                ? step4Action
                : `${SFMTA_BASE}${step4Action}`;

              const step4FormData = new URLSearchParams();

              step4Form.find('input[type="hidden"]').each((_, el) => {
                const name = $step4(el).attr("name");
                const value = $step4(el).attr("value") || "";
                if (name) step4FormData.append(name, value);
              });

              step4Form
                .find('input[type="text"], input[type="email"], input[type="tel"]')
                .each((_, el) => {
                  const name = ($step4(el).attr("name") || "").toLowerCase();
                  const id = ($step4(el).attr("id") || "").toLowerCase();
                  const fieldKey = name + id;

                  if (fieldKey.includes("email")) {
                    step4FormData.append($step4(el).attr("name") || "", email);
                  } else if (
                    fieldKey.includes("phone") ||
                    fieldKey.includes("tel")
                  ) {
                    step4FormData.append($step4(el).attr("name") || "", phone);
                  }
                });

              step4Form.find("textarea").each((_, el) => {
                const name = $step4(el).attr("name");
                if (name) step4FormData.append(name, reason);
              });

              step4Form.find('input[type="checkbox"]').each((_, el) => {
                const name = $step4(el).attr("name");
                const value = $step4(el).attr("value") || "on";
                if (name) step4FormData.append(name, value);
              });

              const submitBtn4 = step4Form.find(
                'input[type="submit"], button[type="submit"]'
              );
              if (submitBtn4.length > 0) {
                const btnName = submitBtn4.first().attr("name");
                const btnValue = submitBtn4.first().attr("value") || "";
                if (btnName) step4FormData.append(btnName, btnValue);
              }

              await fetch(fullStep4Action, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Cookie: cookies.join("; "),
                  "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Referer: DISPUTE_PAGE,
                  Origin: SFMTA_BASE,
                },
                body: step4FormData.toString(),
                redirect: "manual",
              });
            }
          }
        }

        // Done
        sendEvent(controller, {
          type: "done",
          message: `Your dispute for citation ${citationNumber} has been submitted to SFMTA. You should receive a confirmation at ${email || "your registered email"}. The review process typically takes 2-4 weeks.`,
        });
      } catch (error) {
        console.error("Dispute submission error:", error);
        sendEvent(controller, {
          type: "error",
          stepIndex: 0,
          message: `Failed to submit dispute: ${error instanceof Error ? error.message : "Unknown error"}. Please try again or submit manually at the SFMTA website.`,
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
