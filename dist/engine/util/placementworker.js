
// jsClipper uses X/Y instead of x/y...
function toClipperCoordinates(polygon){
	var clone = [];
	for(var i=0; i<polygon.length; i++){
		clone.push({
			X: polygon[i].x,
			Y: polygon[i].y
		});
	}
	
	return clone;
};

function toNestCoordinates(polygon, scale){
	var clone = [];
	for(var i=0; i<polygon.length; i++){
		clone.push({
			x: polygon[i].X/scale,
			y: polygon[i].Y/scale
		});
	}
	
	return clone;
};

function rotatePolygon(polygon, degrees){
	var rotated = [];
	var mirrored = degrees >= 360;
	var angle = (degrees % 360) * Math.PI / 180;
	for(var i=0; i<polygon.length; i++){
		var x = polygon[i].x * (mirrored ? -1 : 1);
		var y = polygon[i].y;
		var x1 = x*Math.cos(angle)-y*Math.sin(angle);
		var y1 = x*Math.sin(angle)+y*Math.cos(angle);
						
		rotated.push({x:x1, y:y1});
	}
	
	if(mirrored) rotated.reverse();
	if(polygon.children && polygon.children.length > 0){
		rotated.children = [];
		for(var j=0; j<polygon.children.length; j++){
			rotated.children.push(rotatePolygon(polygon.children[j], degrees));
		}
	}
	
	return rotated;
};

function PlacementWorker(binPolygon, paths, ids, rotations, config, nfpCache){
	this.binPolygon = binPolygon;
	this.paths = paths;
	this.ids = ids;
	this.rotations = rotations;
	this.config = config;
	this.nfpCache = nfpCache || {};
	
	// return a placement for the paths/rotations given
	// happens inside a webworker
	this.placePaths = function(paths){

		var self = global.env.self;

		if(!self.binPolygon){
			return null;
		}		
		
		var i, j, k, m, n, path;
		
		// rotate paths by given rotation
		var rotated = [];
		for(i=0; i<paths.length; i++){
			var r = rotatePolygon(paths[i], paths[i].rotation);
			r.rotation = paths[i].rotation;
			r.source = paths[i].source;
			r.id = paths[i].id;
			rotated.push(r);
		}
		
		paths = rotated;
		
		var allplacements = [];
		var reports = [];
		var originalCount = paths.length;
		var sheetBounds = GeometryUtil.getPolygonBounds(self.binPolygon);
		var binarea = Math.abs(GeometryUtil.polygonArea(self.binPolygon));
		var key, nfp;
		
		while(paths.length > 0){
			
			var placed = [];
			var placements = [];
			// Count only sheets with placements; an unsuccessful attempt is not a sheet.

			for(i=0; i<paths.length; i++){
				path = paths[i];
				
				// inner NFP
				key = JSON.stringify({A:-1,B:path.id,inside:true,Arotation:0,Brotation:path.rotation});
				var binNfp = self.nfpCache[key];
				
				// part unplaceable, skip
				if(!binNfp || binNfp.length == 0){
					continue;
				}
				
				// ensure all necessary NFPs exist
				var error = false;
				for(j=0; j<placed.length; j++){			
					key = JSON.stringify({A:placed[j].id,B:path.id,inside:false,Arotation:placed[j].rotation,Brotation:path.rotation});
					nfp = self.nfpCache[key];
										
					if(!nfp){
						error = true;
						break;
					}	
				}
				
				// part unplaceable, skip
				if(error){
					continue;
				}
				
				var position = null;
				if(placed.length == 0){
					// first placement, put it on the left
					for(j=0; j<binNfp.length; j++){
						for(k=0; k<binNfp[j].length; k++){
							if(position === null || binNfp[j][k].x-path[0].x < position.x-1e-7 ||
								(Math.abs(binNfp[j][k].x-path[0].x-position.x)<1e-7 && binNfp[j][k].y-path[0].y < position.y)){
								position = {
									x: binNfp[j][k].x-path[0].x,
									y: binNfp[j][k].y-path[0].y,
									id: path.id,
									rotation: path.rotation
								}
							}
						}
					}
					
					placements.push(position);
					placed.push(path);
					
					continue;
				}
				
				var clipperBinNfp = [];
				for(j=0; j<binNfp.length; j++){
					clipperBinNfp.push(toClipperCoordinates(binNfp[j]));
				}
				
				ClipperLib.JS.ScaleUpPaths(clipperBinNfp, self.config.clipperScale);
				
				var clipper = new ClipperLib.Clipper();
				var combinedNfp = new ClipperLib.Paths();
				
				
				for(j=0; j<placed.length; j++){			
					key = JSON.stringify({A:placed[j].id,B:path.id,inside:false,Arotation:placed[j].rotation,Brotation:path.rotation});
					nfp = self.nfpCache[key];
										
					if(!nfp){
						continue;
					}
					
					for(k=0; k<nfp.length; k++){
						var clone = toClipperCoordinates(nfp[k]);
						for(m=0; m<clone.length; m++){
							clone[m].X += placements[j].x;
							clone[m].Y += placements[j].y;
						}
						
						ClipperLib.JS.ScaleUpPath(clone, self.config.clipperScale);
						clone = ClipperLib.Clipper.CleanPolygon(clone, 0.0001*self.config.clipperScale);
						var area = Math.abs(ClipperLib.Clipper.Area(clone));
						if(clone.length > 2 && area > 0.1*self.config.clipperScale*self.config.clipperScale){
							clipper.AddPath(clone, ClipperLib.PolyType.ptSubject, true);
						}
					}		
				}
				
				if(!clipper.Execute(ClipperLib.ClipType.ctUnion, combinedNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
					continue;
				}
				
				// difference with bin polygon
				var finalNfp = new ClipperLib.Paths();
				clipper = new ClipperLib.Clipper();
				
				clipper.AddPaths(combinedNfp, ClipperLib.PolyType.ptClip, true);
				clipper.AddPaths(clipperBinNfp, ClipperLib.PolyType.ptSubject, true);
				if(!clipper.Execute(ClipperLib.ClipType.ctDifference, finalNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
					continue;
				}
				
				finalNfp = ClipperLib.Clipper.CleanPolygons(finalNfp, 0.0001*self.config.clipperScale);
				
				for(j=0; j<finalNfp.length; j++){
					var area = Math.abs(ClipperLib.Clipper.Area(finalNfp[j]));
					if(finalNfp[j].length < 3 || area < 0.1*self.config.clipperScale*self.config.clipperScale){
						finalNfp.splice(j,1);
						j--;
					}
				}
				
				if(!finalNfp || finalNfp.length == 0){
					continue;
				}
				
				var f = [];
				for(j=0; j<finalNfp.length; j++){
					// back to normal scale
					f.push(toNestCoordinates(finalNfp[j], self.config.clipperScale));
				}
				finalNfp = f;
				
				// Cache the occupied bounds once per part, not once per candidate.
				// Maximise one recoverable edge rectangle, then minimise the cluster.
				var occupiedPoints=[];
				for(m=0;m<placed.length;m++) for(n=0;n<placed[m].length;n++)
					occupiedPoints.push({x:placed[m][n].x+placements[m].x,y:placed[m][n].y+placements[m].y});
				var occupiedBounds=PaperOffcut.bounds(occupiedPoints);
				var partBounds=PaperOffcut.bounds(path);
				var bestFree=-Infinity, bestBox=Infinity, bestAnchor=Infinity;
				var nf, shiftvector;

				for(j=0; j<finalNfp.length; j++){
					nf = finalNfp[j];
					if(Math.abs(GeometryUtil.polygonArea(nf)) < 2){
						continue;
					}
					
					for(k=0; k<nf.length; k++){
						shiftvector = {
							x: nf[k].x-path[0].x,
							y: nf[k].y-path[0].y,
							id: path.id,
							rotation: path.rotation,
							nfp: combinedNfp
						};
						
						var x=Math.min(occupiedBounds.x,partBounds.x+shiftvector.x);
						var y=Math.min(occupiedBounds.y,partBounds.y+shiftvector.y);
						var right=Math.max(occupiedBounds.x+occupiedBounds.w,partBounds.x+partBounds.w+shiftvector.x);
						var bottom=Math.max(occupiedBounds.y+occupiedBounds.h,partBounds.y+partBounds.h+shiftvector.y);
						var footprint={x:x,y:y,w:right-x,h:bottom-y};
						var spare=PaperOffcut.edgeRectangle(footprint,{x:0,y:0,w:sheetBounds.width,h:sheetBounds.height});
						var free=spare.w*spare.h,box=footprint.w*footprint.h,anchor=x+y;
						if(free>bestFree+1e-5 || (Math.abs(free-bestFree)<1e-5 &&
							(box<bestBox-1e-5 || (Math.abs(box-bestBox)<1e-5 && anchor<bestAnchor)))){
							bestFree=free;bestBox=box;bestAnchor=anchor;position=shiftvector;
						}
					}
				}
				if(position){
					placed.push(path);
					placements.push(position);
				}
			}
			
			if(placements.length){
				var outlines=[];
				for(var pi=0;pi<placed.length;pi++){
					var raw=self.config.offcut && self.config.offcut.outlines[placed[pi].source];
					var outline=raw?rotatePolygon(raw,placed[pi].rotation):placed[pi];
					outlines.push(outline.map(function(p){return {x:p.x+placements[pi].x,y:p.y+placements[pi].y};}));
				}
				var options=self.config.offcut || {width:sheetBounds.width,height:sheetBounds.height,padding:0};
				reports.push(PaperOffcut.collect(outlines,{x:options.origin||0,y:options.origin||0,w:options.width,h:options.height},options.padding,options.minArea === undefined ? Infinity : options.minArea));
			}

			for(i=0; i<placed.length; i++){
				var index = paths.indexOf(placed[i]);
				if(index >= 0){
					paths.splice(index,1);
				}
			}
			
			if(placements && placements.length > 0){
				allplacements.push(placements);
			}
			else{
				break; // something went wrong
			}
		}
		
		// there were parts that couldn't be placed
		// Placing one more part outranks any number of extra sheets.
		if(!self.config.offcut || self.config.offcut.minArea === undefined) reports.forEach(function(r){delete r.rectangles;});
		var fitness = PaperOffcut.score(paths.length, reports);
		
		return {placements: allplacements, fitness: fitness, paths: paths, area: binarea };
	};

}
(typeof window !== 'undefined' ? window : self).PlacementWorker = PlacementWorker;

// clipperjs uses alerts for warnings
function alert(message) { 
    console.log('alert: ', message);
}
