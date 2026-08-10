import { createRoot } from "react-dom/client";
import WorkoutApp from "./app/WorkoutApp";
import "./app/workout.css";

const root = document.getElementById("root");
if (!root) throw new Error("Workout app root element is missing.");

createRoot(root).render(<WorkoutApp />);
