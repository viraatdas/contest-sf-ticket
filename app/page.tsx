"use client";

import { useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Shield,
} from "lucide-react";

type Step = 1 | 2 | 3;

interface TicketData {
  citationNumber: string;
  violationDate: string;
  violationCode: string;
  location: string;
  vehiclePlate: string;
  fineAmount: string;
}

interface SubmissionStep {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [image, setImage] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ticketData, setTicketData] = useState<Partial<TicketData>>({});
  const [citationNumber, setCitationNumber] = useState("");
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [submissionSteps, setSubmissionSteps] = useState<SubmissionStep[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      processFile(file);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    []
  );

  const processFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setImage(base64);
      setParsing(true);
      setErrorMessage("");

      try {
        const res = await fetch("/api/parse-ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
        });
        const data = await res.json();
        if (data.error) {
          setErrorMessage(data.error);
          setParsing(false);
          return;
        }
        setTicketData(data);
        setCitationNumber(data.citationNumber || "");
        setParsing(false);
        setStep(2);
      } catch {
        setErrorMessage(
          "Failed to parse ticket image. You can still continue manually."
        );
        setParsing(false);
        setStep(2);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!citationNumber.trim()) {
      setErrorMessage("Citation number is required");
      return;
    }
    if (!reason.trim()) {
      setErrorMessage("Please provide a reason for contesting");
      return;
    }

    setStep(3);
    setSubmitting(true);
    setErrorMessage("");
    setSubmissionSteps([
      { label: "Accessing SFMTA dispute portal", status: "active" },
      { label: "Solving CAPTCHA", status: "pending" },
      { label: "Submitting citation number", status: "pending" },
      { label: "Entering dispute details", status: "pending" },
      { label: "Submitting contact information", status: "pending" },
      { label: "Finalizing dispute", status: "pending" },
    ]);

    try {
      const res = await fetch("/api/submit-dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          citationNumber: citationNumber.trim(),
          reason: reason.trim(),
          email: email.trim(),
          phone: phone.trim(),
          ticketData,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "step") {
                setSubmissionSteps((prev) =>
                  prev.map((s, i) => {
                    if (i === event.stepIndex) return { ...s, status: "active" };
                    if (i < event.stepIndex) return { ...s, status: "done" };
                    return s;
                  })
                );
              } else if (event.type === "done") {
                setSubmissionSteps((prev) =>
                  prev.map((s) => ({ ...s, status: "done" }))
                );
                setSubmitting(false);
                setSubmitted(true);
                setSuccessMessage(
                  event.message || "Your dispute has been submitted successfully!"
                );
              } else if (event.type === "error") {
                setSubmissionSteps((prev) =>
                  prev.map((s, i) =>
                    i === event.stepIndex ? { ...s, status: "error" } : s
                  )
                );
                setSubmitting(false);
                setErrorMessage(
                  event.message || "An error occurred during submission."
                );
              }
            } catch {
              /* skip */
            }
          }
        }
      }
    } catch {
      setSubmitting(false);
      setErrorMessage("Failed to submit dispute. Please try again.");
    }
  };

  const startOver = () => {
    setStep(1);
    setImage(null);
    setParsing(false);
    setSubmitting(false);
    setSubmitted(false);
    setTicketData({});
    setCitationNumber("");
    setReason("");
    setEmail("");
    setPhone("");
    setErrorMessage("");
    setSuccessMessage("");
    setSubmissionSteps([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-2xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <Shield className="h-5 w-5 text-gray-400" strokeWidth={1.5} />
            <h1 className="text-lg font-light tracking-tight text-gray-900">
              Contest SF Parking Ticket
            </h1>
          </div>
          <p className="text-sm font-light text-gray-500 ml-8">
            Upload your ticket, explain your case, and we&apos;ll file the dispute
            automatically with SFMTA.
          </p>
          {/* Step indicator */}
          <div className="flex items-center gap-2 ml-8 mt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    s === step
                      ? "w-8 bg-gray-900"
                      : s < step
                      ? "w-4 bg-gray-400"
                      : "w-4 bg-gray-200"
                  }`}
                />
              </div>
            ))}
            <span className="text-xs font-light text-gray-400 ml-2">
              {step === 1
                ? "Upload ticket"
                : step === 2
                ? "Your details"
                : submitted
                ? "Done"
                : "Submitting"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        {/* ── Step 1: Upload ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => !parsing && fileInputRef.current?.click()}
              className={`border border-dashed rounded-xl transition-colors ${
                image
                  ? "border-gray-200"
                  : "border-gray-300 hover:border-gray-400 hover:bg-gray-50/50 cursor-pointer"
              } ${parsing ? "pointer-events-none opacity-70" : ""}`}
            >
              {!image ? (
                <div className="p-16 text-center">
                  <Upload
                    className="h-10 w-10 text-gray-300 mx-auto mb-4"
                    strokeWidth={1}
                  />
                  <p className="text-base font-light text-gray-500">
                    Drag and drop your ticket image
                  </p>
                  <p className="text-sm font-light text-gray-400 mt-1">
                    or{" "}
                    <span className="text-gray-900 underline underline-offset-2">
                      browse files
                    </span>
                  </p>
                  <p className="text-xs font-light text-gray-300 mt-3">
                    PNG, JPG, or HEIC
                  </p>
                </div>
              ) : (
                <div className="p-4">
                  <img
                    src={image}
                    alt="Parking ticket"
                    className="w-full h-auto max-h-80 object-contain rounded-lg bg-gray-50"
                  />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {parsing && (
              <div className="flex items-center justify-center gap-2 text-sm font-light text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing your ticket...
              </div>
            )}

            {errorMessage && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm font-light text-red-700">{errorMessage}</p>
              </div>
            )}

            {image && !parsing && (
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setImage(null);
                    setErrorMessage("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="font-light text-sm border-gray-200"
                >
                  Choose different image
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-light h-11 text-sm"
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Details ── */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Parsed ticket summary */}
            <Card className="border-gray-200 shadow-none">
              <CardContent className="pt-5">
                <div className="flex items-start gap-4">
                  {image && (
                    <img
                      src={image}
                      alt="Ticket"
                      className="w-20 h-20 object-cover rounded-lg border border-gray-200 shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-light text-gray-400">
                        Citation Number
                      </Label>
                      <Input
                        value={citationNumber}
                        onChange={(e) => setCitationNumber(e.target.value)}
                        placeholder="e.g. 7654321012"
                        className="font-mono text-sm border-gray-200"
                        maxLength={11}
                      />
                    </div>
                    {(ticketData.location ||
                      ticketData.violationCode ||
                      ticketData.violationDate ||
                      ticketData.fineAmount) && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm font-light">
                        {ticketData.violationDate && (
                          <div>
                            <span className="text-xs text-gray-400">Date</span>
                            <p className="text-gray-700">
                              {ticketData.violationDate}
                            </p>
                          </div>
                        )}
                        {ticketData.fineAmount && (
                          <div>
                            <span className="text-xs text-gray-400">Fine</span>
                            <p className="text-gray-700">
                              {ticketData.fineAmount}
                            </p>
                          </div>
                        )}
                        {ticketData.location && (
                          <div>
                            <span className="text-xs text-gray-400">
                              Location
                            </span>
                            <p className="text-gray-700 truncate">
                              {ticketData.location}
                            </p>
                          </div>
                        )}
                        {ticketData.violationCode && (
                          <div>
                            <span className="text-xs text-gray-400">
                              Violation
                            </span>
                            <p className="text-gray-700 truncate">
                              {ticketData.violationCode}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Separator className="bg-gray-100" />

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-xs font-light text-gray-600">
                Why are you contesting? *
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe why this ticket should be dismissed. Include any relevant details such as signage issues, meter malfunctions, valid permits, etc."
                className="min-h-[120px] text-sm font-light border-gray-200 resize-none"
              />
            </div>

            {/* Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-xs font-light text-gray-600"
                >
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="text-sm border-gray-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="phone"
                  className="text-xs font-light text-gray-600"
                >
                  Phone Number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(415) 555-0123"
                  className="text-sm border-gray-200"
                />
              </div>
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm font-light text-red-700">{errorMessage}</p>
              </div>
            )}

            {/* Navigation */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setErrorMessage("");
                }}
                className="font-light text-sm border-gray-200"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!citationNumber.trim() || !reason.trim()}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-light h-11 text-sm disabled:opacity-40"
              >
                Submit Contest
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Submitting / Done ── */}
        {step === 3 && (
          <div className="space-y-6">
            <Card className="border-gray-200 shadow-none">
              <CardContent className="pt-6 pb-6">
                <div className="space-y-4">
                  {submissionSteps.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      {s.status === "pending" && (
                        <div className="h-4 w-4 rounded-full border border-gray-200" />
                      )}
                      {s.status === "active" && (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
                      )}
                      {s.status === "done" && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      {s.status === "error" && (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span
                        className={`text-sm font-light ${
                          s.status === "active"
                            ? "text-gray-900"
                            : s.status === "done"
                            ? "text-gray-500"
                            : s.status === "error"
                            ? "text-red-600"
                            : "text-gray-400"
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {submitted && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-green-50 border border-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-normal text-green-800">
                    Dispute Submitted
                  </p>
                  <p className="text-sm font-light text-green-700 mt-1">
                    {successMessage}
                  </p>
                </div>
              </div>
            )}

            {errorMessage && !submitting && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm font-light text-red-700">{errorMessage}</p>
              </div>
            )}

            {!submitting && (
              <Button
                onClick={startOver}
                variant="outline"
                className="w-full font-light text-sm border-gray-200 h-11"
              >
                {submitted ? "Contest Another Ticket" : "Try Again"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-auto">
        <div className="max-w-2xl mx-auto px-6 py-4">
          <p className="text-xs font-light text-gray-400 text-center">
            This tool automates the SFMTA online dispute process on your behalf.
            Not affiliated with SFMTA or the City of San Francisco.
          </p>
        </div>
      </footer>
    </main>
  );
}
