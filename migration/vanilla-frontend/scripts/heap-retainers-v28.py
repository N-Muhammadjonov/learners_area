#!/usr/bin/env python3
"""Read a V8/Chromium heap snapshot offline. Never trigger GC or retain page nodes.
Usage: python3 scripts/heap-retainers-v27.py SNAPSHOT OUTPUT
Weak edges are excluded; paths are evidence of reachability, not dominator sizes.
"""
import collections
import hashlib
import json
import pathlib
import sys

source, destination = map(pathlib.Path, sys.argv[1:])
raw = source.read_bytes()
heap = json.loads(raw)
meta = heap['snapshot']['meta']
fields, edge_fields = meta['node_fields'], meta['edge_fields']
stride, edge_stride = len(fields), len(edge_fields)
strings, flat_nodes, flat_edges = heap['strings'], heap['nodes'], heap['edges']
node_types, edge_types = meta['node_types'][0], meta['edge_types'][0]
nodes, incoming, cursor = {}, collections.defaultdict(list), 0
for index in range(0, len(flat_nodes), stride):
    row = dict(zip(fields, flat_nodes[index:index + stride]))
    row.update(index=index, type=node_types[row['type']], name=strings[row['name']])
    nodes[index] = row
    for _ in range(row['edge_count']):
        edge = dict(zip(edge_fields, flat_edges[cursor:cursor + edge_stride]))
        cursor += edge_stride
        kind = edge_types[edge['type']]
        label = str(edge['name_or_index']) if kind in ('element', 'hidden') else strings[edge['name_or_index']]
        incoming[edge['to_node']].append((index, kind, label))

def path_to_root(start):
    queue, seen = collections.deque([(start, [])]), {start}
    while queue:
        index, path = queue.popleft()
        row = nodes[index]
        if row['type'] == 'synthetic' and ('roots' in row['name'].lower() or row['name'] == '(Global handles)'):
            return path
        if len(path) >= 30:
            continue
        for origin, kind, label in incoming[index]:
            if kind == 'weak' or origin in seen:
                continue
            seen.add(origin)
            owner = nodes[origin]
            queue.append((origin, path + [dict(id=owner['id'], type=owner['type'], name=owner['name'], edgeType=kind, edgeName=label)]))
    return None

detached = [n for n in nodes.values() if n['type'] == 'native' and n.get('detachedness') == 2 and (n['name'].startswith('<') or n['name'] in ('Text', 'HTMLDocument', 'DocumentFragment'))]
counts = collections.Counter()
examples = {}
all_non_animation = []
for target in detached:
    path = path_to_root(target['index'])
    names = [n['name'] for n in path or []]
    category = 'CSSAnimation' if 'CSSAnimation' in names else 'CSSTransition' if 'CSSTransition' in names else 'otherStrongPath' if path else 'noStrongRootWithin30Edges'
    counts[category] += 1
    if category not in ('CSSAnimation', 'CSSTransition'):
        all_non_animation.append(dict(targetId=target['id'], targetName=target['name'], retainingPath=path, directIncoming=[dict(id=nodes[i]['id'], type=nodes[i]['type'], name=nodes[i]['name'], edgeType=k, edgeName=l) for i,k,l in incoming[target['index']] if k != 'weak']))
    # One DOM-loading example per category, not an exhaustive dump of page text.
    if category not in examples and target['name'].startswith('<'):
        examples[category] = dict(targetId=target['id'], targetName=target['name'], retainingPath=path)
report = dict(snapshotName=source.name, snapshotSHA256=hashlib.sha256(raw).hexdigest(), snapshotBytes=len(raw), nodeFields=fields, detachedDOMTargets=len(detached), shortestStrongPathCategories=dict(counts), examples=examples, allNonAnimationTargets=all_non_animation, limitations=['Shortest strong incoming paths, not dominator or exclusive-ownership analysis.', 'No weak edges traversed; no path within30 edges is not proof of unreachability.', 'Snapshot protocol may affect scheduling; counters before/after capture are separate evidence.'])
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k:v for k,v in report.items() if k not in ('examples','nodeFields','allNonAnimationTargets')}, indent=2))
