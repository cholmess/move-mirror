import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { MicroLesson } from "./components/MicroLesson";
import { TrainingBoard } from "./components/TrainingBoard";
import { ProfileView } from "./components/ProfileView";
import { TransferView } from "./components/TransferView";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="lesson" element={<MicroLesson />} />
            <Route path="train" element={<TrainingBoard />} />
            <Route path="profile" element={<ProfileView />} />
            <Route path="transfer" element={<TransferView />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
