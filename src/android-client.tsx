// Only the Android standalone client uses this entry.
// The website keeps TanStack Start SSR unchanged.
import "./polyfills";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

const mount = document.getElementById("root");
if (!mount) throw new Error("Nova Android: #root is missing");
const router = getRouter();
createRoot(mount).render(<RouterProvider router={router} />);
