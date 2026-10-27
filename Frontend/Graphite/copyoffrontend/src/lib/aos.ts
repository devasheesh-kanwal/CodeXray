import AOS from 'aos';
import 'aos/dist/aos.css';

export const AOS_DURATION = 800;
export const AOS_OFFSET = 80;
export const AOS_STAGGER = 100;

export function initAOS(reduceMotion: boolean): void {
  AOS.init({
    duration: AOS_DURATION,
    easing: 'ease-out-cubic',
    once: true,
    offset: AOS_OFFSET,
    disable: reduceMotion,
  });
}

export function refreshAOS(): void {
  AOS.refresh();
}