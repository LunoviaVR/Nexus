import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { errorText } from "./lib/ipc";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend already retries VRChat's hiccups, and a rate limit is only made worse by asking
      // again, so the one thing worth another go here is a dropped connection.
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
