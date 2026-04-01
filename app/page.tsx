"use client";

import { useState, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  FileImage,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Shield,
} from "lucide-react";

type Status = "idle" | "parsing" | "parsed" | "submitting" | "success" | "error";

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
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [ticketData, setTicketData] = useState<Partial<TicketData>>({});
  const [citationNumber, setCitationNumber] = useState("");
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [steps, setSteps] = useState<SubmissionStep[]>([]);
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
      if (file) {
        processFile(file);
      }
    },
    []
  );

  const processFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setImage(base64);
      await parseTicket(base64);
    };
    reader.readAsDataURL(file);
  };

  const parseTicket = async (base64Image: string) => {
    setStatus("parsing");
    setErrorMessage("");
    try {
      const res = await fetch("/api/parse-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image }),
      });
      const data = await res.json();
      if (data.error) {
        setStatus("error");
        setErrorMessage(data.error);
        return;
      }
      setTicketData(data);
      setCitationNumber(data.citationNumber || "");
      setStatus("parsed");
    } catch {
      setErrorMessage("Failed to parse ticket image. Please enter details manually.");
      setStatus("idle");
    }
  };

  const removeImage = () => {
    setImage(null);
    setTicketData({});
    setCitationNumber("");
    setStatus("idle");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!citationNumber.trim()) {
      setErrorMessage("Citation number is required");
      return;
    }
    if (!reason.trim()) {
      setErrorMessage("Please provide a reason for contesting");
      return;
    }

    setStatus("submitting");
    setErrorMessage("");
    setSteps([
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
                setSteps((prev) =>
                  prev.map((s, i) => {
                    if (i === event.stepIndex) return { ...s, status: "active" };
                    if (i < event.stepIndex) return { ...s, status: "done" };
                    return s;
                  })
                );
              } else if (event.type === "done") {
                setSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));
                setStatus("success");
                setSuccessMessage(
                  event.message || "Your dispute has been submitted successfully!"
                );
              } else if (event.type === "error") {
                setSteps((prev) =>
                  prev.map((s, i) => {
                    if (i === event.stepIndex)
                      return { ...s, status: "error" };
                    return s;
                  })
                );
                setStatus("error");
                setErrorMessage(event.message || "An error occurred during submission.");
              }
            } catch {
              // skip malformed events
            }
          }
        }
      }
    } catch {
      setStatus("error");
      setErrorMessage("Failed to submit dispute. Please try again.");
    }
  };

  const canSubmit =
    citationNumber.trim() &&
    reason.trim() &&
    status !== "submitting" &&
    status !== "parsing";

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
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Upload Section */}
          <Card className="border-gray-200 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-normal text-gray-900">
                Ticket Image
              </CardTitle>
              <CardDescription className="text-xs font-light">
                Upload a photo of your parking ticket to auto-extract details
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!image ? (
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50/50 transition-colors"
                >
                  <Upload
                    className="h-8 w-8 text-gray-300 mx-auto mb-3"
                    strokeWidth={1}
                  />
                  <p className="text-sm font-light text-gray-500">
                    Drag and drop your ticket image, or{" "}
                    <span className="text-gray-900 underline underline-offset-2">
                      browse
                    </span>
                  </p>
                  <p className="text-xs font-light text-gray-400 mt-1">
                    PNG, JPG, or HEIC
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="relative">
                  <div className="relative rounded-lg overflow-hidden border border-gray-200">
                    <img
                      src={image}
                      alt="Parking ticket"
                      className="w-full h-auto max-h-64 object-contain bg-gray-50"
                    />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute top-2 right-2 p-1 rounded-full bg-white/80 hover:bg-white border border-gray-200 transition-colors"
                    >
                      <X className="h-3.5 w-3.5 text-gray-600" />
                    </button>
                  </div>
                  {status === "parsing" && (
                    <div className="flex items-center gap-2 mt-3 text-sm font-light text-gray-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Analyzing ticket...
                    </div>
                  )}
                  {status === "parsed" && ticketData.citationNumber && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge
                        variant="secondary"
                        className="font-light text-xs bg-gray-100 text-gray-700"
                      >
                        <FileImage className="h-3 w-3 mr-1" />
                        Parsed successfully
                      </Badge>
                      {ticketData.violationDate && (
                        <Badge
                          variant="secondary"
                          className="font-light text-xs bg-gray-100 text-gray-700"
                        >
                          {ticketData.violationDate}
                        </Badge>
                      )}
                      {ticketData.fineAmount && (
                        <Badge
                          variant="secondary"
                          className="font-light text-xs bg-gray-100 text-gray-700"
                        >
                          {ticketData.fineAmount}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Citation Details */}
          <Card className="border-gray-200 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-normal text-gray-900">
                Citation Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="citation"
                  className="text-xs font-light text-gray-600"
                >
                  Citation Number *
                </Label>
                <Input
                  id="citation"
                  value={citationNumber}
                  onChange={(e) => setCitationNumber(e.target.value)}
                  placeholder="e.g. 7654321012"
                  className="font-mono text-sm border-gray-200 focus:border-gray-400 focus:ring-gray-400"
                  maxLength={11}
                />
              </div>

              {(ticketData.location || ticketData.violationCode) && (
                <>
                  <Separator className="bg-gray-100" />
                  <div className="grid grid-cols-2 gap-4 text-sm font-light">
                    {ticketData.location && (
                      <div>
                        <span className="text-xs text-gray-400 block mb-0.5">
                          Location
                        </span>
                        <span className="text-gray-700">
                          {ticketData.location}
                        </span>
                      </div>
                    )}
                    {ticketData.violationCode && (
                      <div>
                        <span className="text-xs text-gray-400 block mb-0.5">
                          Violation
                        </span>
                        <span className="text-gray-700">
                          {ticketData.violationCode}
                        </span>
                      </div>
                    )}
                    {ticketData.vehiclePlate && (
                      <div>
                        <span className="text-xs text-gray-400 block mb-0.5">
                          License Plate
                        </span>
                        <span className="text-gray-700 font-mono">
                          {ticketData.vehiclePlate}
                        </span>
                      </div>
                    )}
                    {ticketData.violationDate && (
                      <div>
                        <span className="text-xs text-gray-400 block mb-0.5">
                          Date
                        </span>
                        <span className="text-gray-700">
                          {ticketData.violationDate}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Dispute Reason */}
          <Card className="border-gray-200 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-normal text-gray-900">
                Your Case
              </CardTitle>
              <CardDescription className="text-xs font-light">
                Explain why you&apos;re contesting this ticket
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="reason"
                  className="text-xs font-light text-gray-600"
                >
                  Reason for Contesting *
                </Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe why this ticket should be dismissed. Include any relevant details such as signage issues, meter malfunctions, valid permits, etc."
                  className="min-h-[120px] text-sm font-light border-gray-200 focus:border-gray-400 focus:ring-gray-400 resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* Contact Info */}
          <Card className="border-gray-200 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-normal text-gray-900">
                Contact Information
              </CardTitle>
              <CardDescription className="text-xs font-light">
                Required for the dispute form
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    className="text-sm border-gray-200 focus:border-gray-400 focus:ring-gray-400"
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
                    className="text-sm border-gray-200 focus:border-gray-400 focus:ring-gray-400"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error Message */}
          {errorMessage && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm font-light text-red-700">{errorMessage}</p>
            </div>
          )}

          {/* Submission Progress */}
          {status === "submitting" && steps.length > 0 && (
            <Card className="border-gray-200 shadow-none">
              <CardContent className="pt-5">
                <div className="space-y-3">
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      {step.status === "pending" && (
                        <div className="h-4 w-4 rounded-full border border-gray-200" />
                      )}
                      {step.status === "active" && (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
                      )}
                      {step.status === "done" && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      {step.status === "error" && (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span
                        className={`text-sm font-light ${
                          step.status === "active"
                            ? "text-gray-900"
                            : step.status === "done"
                            ? "text-gray-500"
                            : step.status === "error"
                            ? "text-red-600"
                            : "text-gray-400"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Success Message */}
          {status === "success" && (
            <div className="flex items-start gap-2 p-4 rounded-lg bg-green-50 border border-green-100">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-normal text-green-800">
                  Dispute Submitted
                </p>
                <p className="text-sm font-light text-green-700 mt-0.5">
                  {successMessage}
                </p>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white font-light h-11 text-sm disabled:opacity-40"
          >
            {status === "submitting" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Submitting Dispute...
              </>
            ) : (
              <>
                Submit Contest
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
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
