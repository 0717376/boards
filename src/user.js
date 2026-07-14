const ADJ = ["Быстрый", "Хитрый", "Тихий", "Смелый", "Мудрый", "Весёлый", "Ловкий", "Добрый"];
const ANIMAL = ["ёж", "лис", "кот", "сокол", "барсук", "бобр", "волк", "енот"];

// Excalidraw paints remote cursors hsl(hash(collaborator.id) % 37 * 10, 100%, 83%) and ignores
// any color we pass. The hash input is ours though, so we engineer ids that land on calm hues.
const HUES = [220, 260, 340, 30, 140, 200, 290, 350];

function exHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

export function hueId(hue) {
  for (let i = 0; i < 5000; i++) {
    const s = `u${i}`;
    if ((Math.abs(exHash(s)) % 37) * 10 === hue) return s;
  }
  return "u0";
}

export const avatarColor = (hue) => `hsl(${hue}, 46%, 52%)`;

export function getUserName() {
  let name = localStorage.getItem("boards.userName");
  if (!name) {
    name = `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${ANIMAL[Math.floor(Math.random() * ANIMAL.length)]}`;
    localStorage.setItem("boards.userName", name);
  }
  return name;
}

export const setUserName = (name) => localStorage.setItem("boards.userName", name);

export function getUserHue() {
  let h = Number(localStorage.getItem("boards.userHue"));
  if (!HUES.includes(h)) {
    h = HUES[Math.floor(Math.random() * HUES.length)];
    localStorage.setItem("boards.userHue", String(h));
  }
  return h;
}
