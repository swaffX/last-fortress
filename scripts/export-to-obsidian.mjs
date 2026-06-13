#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const graphPath = path.join(projectRoot, '.understand-anything', 'knowledge-graph.json');
const obsidianVault = path.join(projectRoot, 'Obsidian-LastFortress');

// Read graph
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));

// Create vault dirs
const layerDirs = {};
graph.layers.forEach(layer => {
  const dir = path.join(obsidianVault, layer.name.replace(/\s+/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  layerDirs[layer.id] = dir;
});

// Create nodes by layer
const nodesByLayer = {};
graph.layers.forEach(layer => {
  nodesByLayer[layer.id] = new Set(layer.nodeIds);
});

graph.nodes.forEach(node => {
  // Find layer
  let layerId = null;
  for (const [lid, nodeSet] of Object.entries(nodesByLayer)) {
    if (nodeSet.has(node.id)) {
      layerId = lid;
      break;
    }
  }

  const layerDir = layerId ? layerDirs[layerId] : obsidianVault;
  const filename = node.name.replace(/[/\\:*?"<>|]/g, '_');
  const filepath = path.join(layerDir, `${filename}.md`);

  // Build links
  const relatedEdges = graph.edges.filter(e => e.source === node.id || e.target === node.id);
  const linkedNodes = new Set();
  relatedEdges.forEach(edge => {
    if (edge.source === node.id) linkedNodes.add(edge.target);
    if (edge.target === node.id) linkedNodes.add(edge.source);
  });

  // Build markdown
  let md = `---\nid: ${node.id}\ntype: ${node.type}\ntags: [${node.tags?.map(t => `"${t}"`).join(', ') || ''}]\ncomplexity: ${node.complexity || 'unknown'}\n---\n\n`;
  md += `# ${node.name}\n\n`;
  md += `${node.summary || 'No description'}\n\n`;

  if (node.filePath) {
    md += `**Path:** \`${node.filePath}\`\n\n`;
  }

  if (linkedNodes.size > 0) {
    md += `## Related\n\n`;
    [...linkedNodes].forEach(nodeId => {
      const linkedNode = graph.nodes.find(n => n.id === nodeId);
      if (linkedNode) {
        const refName = linkedNode.name.replace(/[/\\:*?"<>|]/g, '_');
        md += `- [[${refName}]]\n`;
      }
    });
    md += '\n';
  }

  fs.writeFileSync(filepath, md);
});

// Create layer index
const indexPath = path.join(obsidianVault, '00-Architecture.md');
let indexMd = `# Last Fortress Architecture\n\n`;
indexMd += `**Analyzed:** ${graph.project.analyzedAt}\n\n`;
indexMd += `## Layers\n\n`;

graph.layers.forEach(layer => {
  indexMd += `### ${layer.name}\n${layer.description}\n\n`;
  layer.nodeIds.forEach(nodeId => {
    const node = graph.nodes.find(n => n.id === nodeId);
    if (node) {
      const refName = node.name.replace(/[/\\:*?"<>|]/g, '_');
      indexMd += `- [[${refName}]]\n`;
    }
  });
  indexMd += '\n';
});

fs.writeFileSync(indexPath, indexMd);

console.log(`✓ Obsidian vault created: ${obsidianVault}`);
console.log(`✓ ${graph.nodes.length} nodes exported`);
console.log(`✓ ${graph.layers.length} layers organized`);
console.log(`\nOpen "${obsidianVault}" as vault in Obsidian → Graph View\n`);
