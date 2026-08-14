import koffi from 'koffi';
import type { BrowserWindow } from 'electron';

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const VK_CONSOLE = 0xC0;
const VK_RETURN = 0x0D;
const SW_RESTORE = 9;

const user32 = process.platform === 'win32' ? koffi.load('user32.dll') : null;
const KEYBDINPUT = koffi.struct('UEM_KEYBDINPUT', {
  wVk: 'uint16_t',
  wScan: 'uint16_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const INPUT = koffi.struct('UEM_INPUT', {
  type: 'uint32_t',
  u: koffi.union({ ki: KEYBDINPUT }),
});

const FindWindowW = user32?.func('intptr_t __stdcall FindWindowW(const char16_t *className, const char16_t *windowName)');
const SetForegroundWindow = user32?.func('bool __stdcall SetForegroundWindow(intptr_t window)');
const ShowWindow = user32?.func('bool __stdcall ShowWindow(intptr_t window, int command)');
const SendInput = user32?.func('unsigned int __stdcall SendInput(unsigned int inputCount, UEM_INPUT *inputs, int inputSize)');

function keyboard(virtualKey: number, scanCode: number, flags: number) {
  return {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: virtualKey, wScan: scanCode, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
  };
}
function sendVirtualKey(virtualKey: number) {
  const inputs = [keyboard(virtualKey, 0, 0), keyboard(virtualKey, 0, KEYEVENTF_KEYUP)];
  if (SendInput?.(inputs.length, inputs, koffi.sizeof(INPUT)) !== inputs.length) throw new Error('Windows did not deliver the automatic UEFN connector keystroke.');
}

function sendUnicode(text: string) {
  const inputs = [...text].flatMap(character => {
    const code = character.charCodeAt(0);
    return [keyboard(0, code, KEYEVENTF_UNICODE), keyboard(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)];
  });
  if (SendInput?.(inputs.length, inputs, koffi.sizeof(INPUT)) !== inputs.length) throw new Error('Windows did not deliver the automatic UEFN connector command.');
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function sendUefnConnectorCommand(
  windowTitle: string | undefined,
  command: string,
  managerWindow: BrowserWindow,
): Promise<boolean> {
  if (!windowTitle || !FindWindowW || !ShowWindow || !SetForegroundWindow || !SendInput) return false;
  const editorWindow = FindWindowW(null, windowTitle);
  if (!editorWindow) return false;
  try {
    ShowWindow(editorWindow, SW_RESTORE);
    if (!SetForegroundWindow(editorWindow)) return false;
    await delay(250);
    sendVirtualKey(VK_CONSOLE);
    await delay(200);
    sendUnicode(command);
    sendVirtualKey(VK_RETURN);
    return true;
  } finally {
    await delay(150);
    if (!managerWindow.isDestroyed()) managerWindow.focus();
  }
}
