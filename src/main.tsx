import React from "react";
import ReactDOM from "react-dom/client";
import AccessGate from "./AccessGate";
import App from "./App";
import ConstructionGate from "./ConstructionGate";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ConstructionGate>
      <AccessGate>
        <App />
      </AccessGate>
    </ConstructionGate>
  </React.StrictMode>,
);
