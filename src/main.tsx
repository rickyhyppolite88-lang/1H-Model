import React from "react";
import ReactDOM from "react-dom/client";
import AppEntry from "./AppEntry";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppEntry />
  </React.StrictMode>,
);
