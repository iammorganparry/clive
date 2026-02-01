import { Routes, Route } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { OverviewPage } from "./components/overview/OverviewPage";
import { MemoriesPage } from "./components/memories/MemoriesPage";
import { DetailPage } from "./components/detail/DetailPage";
import { SearchPage } from "./components/search/SearchPage";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewPage />} />
        <Route path="memories" element={<MemoriesPage />} />
        <Route path="memories/:id" element={<DetailPage />} />
        <Route path="search" element={<SearchPage />} />
      </Route>
    </Routes>
  );
}
