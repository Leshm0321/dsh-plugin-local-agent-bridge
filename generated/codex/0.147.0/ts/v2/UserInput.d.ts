import type { ImageDetail } from "../ImageDetail";
import type { TextElement } from "./TextElement";
export type UserInput = {
    "type": "text";
    text: string;
    /**
     * UI-defined spans within `text` used to render or persist special elements.
     */
    text_elements: Array<TextElement>;
} | {
    "type": "image";
    detail?: ImageDetail;
    url: string;
} | {
    "type": "localImage";
    detail?: ImageDetail;
    path: string;
} | {
    "type": "audio";
    url: string;
} | {
    "type": "localAudio";
    path: string;
} | {
    "type": "skill";
    name: string;
    path: string;
} | {
    "type": "mention";
    name: string;
    path: string;
};
