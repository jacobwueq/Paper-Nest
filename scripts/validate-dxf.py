"""Independent validation: PYTHONPATH=work/dxf-validation python scripts/validate-dxf.py file.dxf ..."""
import sys, json
import ezdxf
for path in sys.argv[1:]:
    doc=ezdxf.readfile(path)
    audit=doc.audit()
    assert not audit.errors and not audit.fixes, [(x.code,x.message) for x in [*audit.errors,*audit.fixes]]
    model=doc.modelspace()
    assert len(model)>0, 'Empty model space'
    assert doc.units==4, 'Expected millimetres'
    assert all(e.dxf.owner==model.block_record.dxf.handle for e in model)
    print(json.dumps({'file':path,'entities':len(model),'groups':len(doc.groups),'units':'mm','errors':0,'repairs':0}))
