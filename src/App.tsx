import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { LocaleHtmlSync } from "./components/LocaleHtmlSync";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { MicroLesson } from "./components/MicroLesson";
import { TrainingBoard } from "./components/TrainingBoard";
import { ProfileView } from "./components/ProfileView";
import { TransferView } from "./components/TransferView";
import { DefenseLab } from "./components/DefenseLab";
import { ImportHub } from "./components/ImportHub";
import { ManualImport } from "./components/ManualImport";
import { GamesLibrary } from "./components/GamesLibrary";
import { GameDetail } from "./components/GameDetail";

export default function App() {
  return (
    <AppProvider>
      <LocaleHtmlSync />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="lesson" element={<MicroLesson />} />
            <Route path="train" element={<TrainingBoard />} />
            <Route path="profile" element={<ProfileView />} />
            <Route path="transfer" element={<TransferView />} />
            <Route path="defense" element={<DefenseLab />} />
            <Route path="import" element={<ImportHub />} />
            <Route path="import/manual" element={<ManualImport />} />
            <Route path="games" element={<GamesLibrary />} />
            <Route path="games/:id" element={<GameDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
