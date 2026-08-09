import fs from 'fs';
import path from 'path';

export interface TextureImportResult {
  success: boolean;
  filePath: string;
  verseAssetPath: string;
  error?: string;
}

export function savePngToContentFolder(
  contentFolderPath: string,
  assetFolderName: string,
  assetName: string,
  pngBuffer: Buffer
): TextureImportResult {
  try {
    const targetDir = path.join(contentFolderPath, assetFolderName);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const cleanAssetName = assetName.replace(/[^a-zA-Z0-9_]/g, '_');
    const pngFileName = `${cleanAssetName}.png`;
    const fullPngPath = path.join(targetDir, pngFileName);

    fs.writeFileSync(fullPngPath, pngBuffer);

    // In Verse, assets placed in Content/<AssetFolder>/<Name> are referenced as:
    // <AssetFolder>.<CleanAssetName>
    const verseAssetPath = `${assetFolderName}.${cleanAssetName}`;

    return {
      success: true,
      filePath: fullPngPath,
      verseAssetPath,
    };
  } catch (err: any) {
    return {
      success: false,
      filePath: '',
      verseAssetPath: '',
      error: err?.message || 'Failed to save PNG texture asset',
    };
  }
}

export function generateUefnPythonImportScript(
  contentFolderPath: string,
  assetFolderName: string
): string {
  return `# UEFN Automated Texture Importer for Entitlement Icons
# Run inside UEFN via Tools > Execute Python Script...
import os
import unreal

def import_entitlement_icons():
    content_dir = r"${contentFolderPath.replace(/\\/g, '/')}"
    icon_dir = os.path.join(content_dir, "${assetFolderName}")
    if not os.path.exists(icon_dir):
        print(f"[IIT Importer] Directory not found: {icon_dir}")
        return

    destination_game_path = "/Game/${assetFolderName}"
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    
    png_files = [f for f in os.listdir(icon_dir) if f.lower().endswith('.png')]
    tasks = []
    
    for f in png_files:
        src_path = os.path.join(icon_dir, f)
        asset_name = os.path.splitext(f)[0]
        
        task = unreal.AssetImportTask()
        task.filename = src_path
        task.destination_path = destination_game_path
        task.destination_name = asset_name
        task.replace_existing = True
        task.automated = True
        task.save = True
        tasks.append(task)
        
    if tasks:
        asset_tools.import_asset_tasks(tasks)
        print(f"[IIT Importer] Successfully imported {len(tasks)} entitlement textures into {destination_game_path}!")

if __name__ == "__main__":
    import_entitlement_icons()
`;
}
