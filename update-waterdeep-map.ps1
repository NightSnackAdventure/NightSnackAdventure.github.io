# Re-syncs the Waterdeep map image + markers from the Obsidian vault into this repo.
# Run this after editing the map in Obsidian (Kartta.md), then commit + push as usual.

$src = "A:\Obsidian\DnD"
$dst = "A:\code\NightSnackAdventure.github.io\maps\waterdeep"

Copy-Item "$src\map-10.01-waterdeep.jpg" "$dst\map-10.01-waterdeep.jpg" -Force
Copy-Item "$src\map-10.01-waterdeep.jpg.markers.json" "$dst\map-10.01-waterdeep.jpg.markers.json" -Force

Write-Host "Map files updated. Review with 'git status', then commit and push to publish."
