import { CampusWorld } from "@/components/campus/CampusWorld";
import "@/components/campus/campus.css";

/** The learning home now opens into the immersive 3D campus.
 * The previous data-rich dashboard remains unchanged at /app/dashboard.
 * Every module continues to use its original route and UI. */
export default function LearningCampusPage() {
  return <CampusWorld />;
}
