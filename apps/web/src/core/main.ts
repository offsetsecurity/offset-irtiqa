import { render } from "preact";
import { html } from "../ui/html.js";
import { App } from "../ui/App.js";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

render(html`<${App} />`, root);
