import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./styles.css";
import App from "./App";
import Tooltip from "./components/Tooltip";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Tooltip />
  </StrictMode>,
);
