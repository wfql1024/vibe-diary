import { renderToString } from "react-dom/server";
import App from "../../src/App";

const html = renderToString(<App />);
console.log("APP_RENDER_OK length=" + html.length + " root=" + html.includes('class="app"'));
