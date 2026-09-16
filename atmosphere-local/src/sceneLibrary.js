import tabsData from "./tabsData.json";
import audioSources from "../audio-sources.json";

const meta = {
  tab_rain: ["Rain", "Weather", "Soft rain settling against the window.", "#83b7d2", "131, 183, 210"],
  tab_coffee_shop: ["Coffee shop", "Everyday", "A warm corner with a gentle social rhythm.", "#d79c68", "215, 156, 104"],
  tab_waterfall: ["Waterfall", "Water", "Cool, continuous movement for clear focus.", "#70c4b8", "112, 196, 184"],
  tab_lightning: ["Lightning", "Weather", "A charged horizon and distant storm light.", "#a59adc", "165, 154, 220"],
  tab_wind: ["Wind", "Air", "Long, open movement across a quiet landscape.", "#a6c6cb", "166, 198, 203"],
  tab_fire: ["Fire", "Warmth", "A low glow for settling in and slowing down.", "#ef8d4d", "239, 141, 77"],
  tab_snow: ["Snow", "Weather", "A muted winter scene with room to think.", "#c2dfef", "194, 223, 239"],
  tab_street: ["Night street", "City", "Passing light after the city quiets.", "#9485cf", "148, 133, 207"],
  tab_leaves: ["Leaves", "Nature", "A moving canopy for an easy, grounded pause.", "#8cb56f", "140, 181, 111"],
  tab_ocean_waves: ["Ocean", "Water", "An open horizon with a repeating natural pace.", "#55a8d0", "85, 168, 208"],
  tab_train: ["Train", "Transit", "A private window in steady motion.", "#c79269", "199, 146, 105"],
  tab_typing: ["Typing", "Focus", "A concentrated desk rhythm for deep work.", "#91a9c0", "145, 169, 192"],
  tab_foot_steps: ["Footsteps", "Movement", "An evening walk with nowhere to be.", "#c59d76", "197, 157, 118"],
  tab_birds: ["Birds", "Nature", "Early light and small movement in the branches.", "#b9c767", "185, 199, 103"],
  tab_white_noise: ["Soft static", "Focus", "A quiet field with nothing asking for attention.", "#bac2cb", "186, 194, 203"],
};

const videoViews = [
  { title: "Original view", start: 0, playbackRate: 1, scale: 1.025, position: "50% 50%" },
  { title: "Close detail", start: 0.24, playbackRate: 0.92, scale: 1.18, position: "36% 48%" },
  { title: "Slow drift", start: 0.52, playbackRate: 0.78, scale: 1.1, position: "64% 44%" },
  { title: "Wide calm", start: 0.76, playbackRate: 0.88, scale: 1.045, position: "50% 62%" },
];

function withoutExtension(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

export const scenes = tabsData.map((scene) => {
  const [title, category, description, accent, accentRgb] = meta[scene.id] || [scene.title, "Atmosphere", scene.description, "#a9bfd0", "169, 191, 208"];
  const mediaName = withoutExtension(scene.background);
  return {
    ...scene,
    title,
    category,
    description,
    accent,
    accentRgb,
    audioTracks: audioSources[scene.id].map((track, index) => ({
      ...track,
      id: `${scene.id}-audio-${index}`,
      src: `/assets/audio/${scene.id.replace(/^tab_/, "")}/${track.file}`,
    })),
    videoLoops: videoViews.map((view, index) => ({
      id: `${scene.id}-video-${index}`,
      title: view.title,
      background: scene.background,
      adaptiveBackground: `adaptive/${mediaName}-720.mp4`,
      poster: `posters/${mediaName}.jpg`,
      ...view,
    })),
  };
});
