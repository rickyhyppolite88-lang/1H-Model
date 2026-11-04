import React from "react";
import ReactDOM from "react-dom/client";
import AccessGate from "./AccessGate";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </React.StrictMode>,
);
