import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { errorText } from "./lib/ipc";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend already waits out rate limits and retries VRChat's hiccups, so asking again
      // here would only add requests. A dropped connection is the one thing worth another go.
      retry: (failures, error) => failures < 1 && errorText(error).startsWith("Network error"),
      retryDelay: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  (await import("./lib/mock")).installMock();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
