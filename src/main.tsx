import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./styles.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Tooltip from "./components/Tooltip";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary label="the viewer">
      <App />
    </ErrorBoundary>
    <Tooltip />
  </StrictMode>,
);
