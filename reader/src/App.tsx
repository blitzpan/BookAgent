import { Routes, Route } from "react-router-dom";
import Shelf from "./pages/Shelf";
import Reader from "./pages/Reader";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Shelf />} />
      <Route path="/book/:storyId" element={<Reader />} />
    </Routes>
  );
}
