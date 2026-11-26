import React from "react";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import AppShell from "./components/AppShell";
import StoryList from "./components/StoryList";
import StoryDetail from "./components/StoryDetail";
import HotspotSettings from "./components/HotspotSettings";
import CharacterList from "./components/CharacterList";
import CharacterDetail from "./components/CharacterDetail";

function LibraryRoute() {
  const navigate = useNavigate();
  return <StoryList onView={(id) => navigate(`/stories/${id}`)} />;
}

function StoryDetailRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <StoryDetail
      storyId={Number(id)}
      onBack={() => navigate("/library")}
      onChanged={() => {}}
      onOpenHotspots={(sid) => navigate(`/stories/${sid}/hotspots`)}
    />
  );
}

function HotspotRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <HotspotSettings storyId={Number(id)} onBack={() => navigate(`/stories/${id}`)} />;
}

function CharacterListRoute() {
  const navigate = useNavigate();
  return <CharacterList onOpen={(id) => navigate(`/characters/${id}`)} />;
}

function CharacterDetailRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <CharacterDetail characterId={Number(id)} onBack={() => navigate("/characters")} />;
}

const App: React.FC = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<Navigate to="/library" replace />} />
      <Route path="/library" element={<LibraryRoute />} />
      <Route path="/characters" element={<CharacterListRoute />} />
      <Route path="/characters/:id" element={<CharacterDetailRoute />} />
      <Route path="/stories/:id" element={<StoryDetailRoute />} />
      <Route path="/stories/:id/hotspots" element={<HotspotRoute />} />
      <Route path="*" element={<Navigate to="/library" replace />} />
    </Route>
  </Routes>
);

export default App;
