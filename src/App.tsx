import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { LocaleHtmlSync } from "./components/LocaleHtmlSync";
import { Layout } from "./components/Layout";
import { CoachHome } from "./components/CoachHome";
import { CoachSession } from "./components/CoachSession";
import { Dashboard } from "./components/Dashboard";
import { MicroLesson } from "./components/MicroLesson";
import { TrainingBoard } from "./components/TrainingBoard";
import { ProfileView } from "./components/ProfileView";
import { TransferView } from "./components/TransferView";
import { DefenseLab } from "./components/DefenseLab";
import { ImportHub } from "./components/ImportHub";
import { ManualImport } from "./components/ManualImport";
import { ScoresheetImport } from "./components/ScoresheetImport";
import { GamesLibrary } from "./components/GamesLibrary";
import { GameDetail } from "./components/GameDetail";
import { SparringView } from "./components/SparringView";

export default function App() {
  return (
    <AppProvider>
      <LocaleHtmlSync />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<CoachHome />} />
            <Route path="coach/session/:sessionId?" element={<CoachSession />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="lesson" element={<MicroLesson />} />
            <Route path="train" element={<TrainingBoard />} />
            <Route path="sparring" element={<SparringView />} />
            <Route path="profile" element={<ProfileView />} />
            <Route path="transfer" element={<TransferView />} />
            <Route path="defense" element={<DefenseLab />} />
            <Route path="import" element={<ImportHub />} />
            <Route path="import/manual" element={<ManualImport />} />
            <Route path="import/scoresheet" element={<ScoresheetImport />} />
            <Route path="import/scoresheet/:draftId" element={<ScoresheetImport />} />
            <Route path="games" element={<GamesLibrary />} />
            <Route path="games/:id" element={<GameDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
