import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { markRuntimeEnvironment } from "./runtimeEnvironment";
import "./styles.css";
import "virtual:mygameslist-game-styles.css";

markRuntimeEnvironment(document.documentElement, import.meta.env.DEV);

const root = document.getElementById("root");
if (!root) throw new Error("Корневой элемент приложения не найден");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
