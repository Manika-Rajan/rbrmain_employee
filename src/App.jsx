import React, { useState } from "react";

const API_URL =
  "https://jp1bupouyl.execute-api.ap-south-1.amazonaws.com/prod/prebook/publish";

export default function App() {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function callAPI() {
    setLoading(true);
    setResult("Calling API...");

    try {
      const payload = {
        reportId: "test123",
        reportName: "Test Report",
        topic: "API Test",
        s3Key: "test/file.pdf",
      };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      setResult(
        JSON.stringify(
          {
            status: res.status,
            response: text,
          },
          null,
          2
        )
      );
    } catch (err) {
      setResult("ERROR: " + err.message);
    }

    setLoading(false);
  }

  return (
    <div
      style={{
        fontFamily: "Arial",
        padding: "40px",
        textAlign: "center",
      }}
    >
      <h1>API Test Page</h1>

      <button
        onClick={callAPI}
        disabled={loading}
        style={{
          padding: "12px 24px",
          fontSize: "16px",
          cursor: "pointer",
        }}
      >
        {loading ? "Calling API..." : "Test API Call"}
      </button>

      <pre
        style={{
          marginTop: "30px",
          textAlign: "left",
          background: "#111",
          color: "#0f0",
          padding: "20px",
          borderRadius: "6px",
          maxWidth: "900px",
          marginLeft: "auto",
          marginRight: "auto",
          overflow: "auto",
        }}
      >
        {result}
      </pre>
    </div>
  );
}
