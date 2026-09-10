import koffi from 'koffi';

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const VK_CONSOLE = 0xC0;
const VK_RETURN = 0x0D;
const SW_RESTORE = 9;

const user32 = process.platform === 'win32' ? koffi.load('user32.dll') : null;
// INPUT contains the largest member of the MOUSEINPUT/KEYBDINPUT/HARDWAREINPUT
// union. Declaring only KEYBDINPUT makes koffi report a 32-byte INPUT on x64,
// while Win32 requires the 40-byte native struct and rejects SendInput with
// ERROR_INVALID_PARAMETER.
const MOUSEINPUT = koffi.struct('UEM_MOUSEINPUT', {
  dx: 'int32_t',
  dy: 'int32_t',
  mouseData: 'uint32_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const KEYBDINPUT = koffi.struct('UEM_KEYBDINPUT', {
  wVk: 'uint16_t',
  wScan: 'uint16_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const HARDWAREINPUT = koffi.struct('UEM_HARDWAREINPUT', {
  uMsg: 'uint32_t',
  wParamL: 'uint16_t',
  wParamH: 'uint16_t',
});
const INPUT = koffi.struct('UEM_INPUT', {
  type: 'uint32_t',
  u: koffi.union({ mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }),
});
export const UEM_INPUT_SIZE = koffi.sizeof(INPUT);

const FindWindowW = user32?.func('intptr_t __stdcall FindWindowW(const char16_t *className, const char16_t *windowName)');
const GetForegroundWindow = user32?.func('intptr_t __stdcall GetForegroundWindow()');
const IsIconic = user32?.func('bool __stdcall IsIconic(intptr_t window)');
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
  if (SendInput?.(inputs.length, inputs, UEM_INPUT_SIZE) !== inputs.length) throw new Error('Windows did not deliver the automatic UEFN connector keystroke.');
}

function sendUnicode(text: string) {
  const inputs = [...text].flatMap(character => {
    const code = character.charCodeAt(0);
    return [keyboard(0, code, KEYEVENTF_UNICODE), keyboard(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)];
  });
  if (SendInput?.(inputs.length, inputs, UEM_INPUT_SIZE) !== inputs.length) throw new Error('Windows did not deliver the automatic UEFN connector command.');
}

function abortError(): Error {
  return new Error('The automatic UEFN connector command was cancelled.');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(abortError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

export async function sendUefnConnectorCommand(
  windowTitle: string | undefined,
  command: string,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  if (!windowTitle || !FindWindowW || !ShowWindow || !SetForegroundWindow || !SendInput) return false;
  throwIfAborted(signal);
  const editorWindow = FindWindowW(null, windowTitle);
  if (!editorWindow) return false;
  const originalForegroundWindow = GetForegroundWindow?.() ?? 0;
  try {
    throwIfAborted(signal);
    if (IsIconic?.(editorWindow)) ShowWindow(editorWindow, SW_RESTORE);
    if (!SetForegroundWindow(editorWindow)) return false;
    await delay(250, signal);
    throwIfAborted(signal);
    sendVirtualKey(VK_CONSOLE);
    await delay(200, signal);
    throwIfAborted(signal);
    sendUnicode(command);
    throwIfAborted(signal);
    sendVirtualKey(VK_RETURN);
    return true;
  } finally {
    await delay(150);
    // Restore the user's original foreground app. UTM must not steal focus or
    // force its own window to the front after delivering the one-time command.
    if (originalForegroundWindow && originalForegroundWindow !== editorWindow) SetForegroundWindow(originalForegroundWindow);
  }
}
