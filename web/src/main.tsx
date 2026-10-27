import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { EveProvider, useEve } from "./data/store";
import { match, usePath } from "./router";
import { TopBar } from "./components/TopBar";
import { SelectionTools } from "./components/SelectionTools";
import { Home } from "./pages/Home";
import { TalkHub, TalkSession } from "./pages/Talk";
import { TalkReview } from "./pages/TalkReview";
import { talkMode } from "./data/talk";
import { Cards } from "./pages/Cards";
import { CardReview } from "./pages/CardReview";
import { AddCards } from "./pages/AddCards";
import { AnkiImport } from "./pages/AnkiImport";
import { News, ArticlePage } from "./pages/News";

type Params = Record<string, string>;
const ROUTES: [string, (p: Params) => React.ReactNode][] = [
  ["/", () => <Home />],
  ["/talk", () => <TalkHub />],
  ["/talk/review", () => <TalkReview />],
  ["/talk/review/:id", (p) => <TalkReview sessionId={Number(p.id)} />],
  ["/talk/:mode", (p) => <TalkSession mode={talkMode(p.mode).id} />],
  ["/cards", () => <Cards />],
  ["/cards/add", () => <AddCards />],
  ["/cards/import", () => <AnkiImport />],
  ["/cards/review/:deck", (p) => <CardReview deck={p.deck} />],
  ["/news", () => <News />],
  ["/news/:id", (p) => <ArticlePage id={p.id} />],
];

function App() {
  const path = usePath();
  const { toast } = useEve();
  let page: React.ReactNode = <Home />;
  for (const [pattern, render] of ROUTES) {
    const params = match(pattern, path);
    if (params) {
      page = render(params);
      break;
    }
  }
  return (
    <>
      <TopBar path={path} />
      <main className="page fade-in" key={path}>
        {page}
      </main>
      <SelectionTools />
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EveProvider>
      <App />
    </EveProvider>
  </StrictMode>,
);
