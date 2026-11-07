# A stand-in for TripoSR with the same inputs, outputs and file layout (triplane_q8.onnx + .data,
# decoder.onnx), so the browser plumbing can be tested where the real 485 MB model can't be downloaded.
# The shape: a ball with a nose pointing +x and a thin plate under it.
import sys, numpy as np, onnx
from onnx import helper as h, TensorProto as T, numpy_helper as nh
out = sys.argv[1]
P = 64; c = (2 * np.arange(P) + 1) / P - 1
tp = np.zeros((1, 3, 40, P, P), np.float32)
U, V = np.meshgrid(c, c)          # U varies along width (x index), V along height
tp[0, 0, 0], tp[0, 0, 1] = U, V   # plane xy: ch0 = x, ch1 = y
tp[0, 1, 0], tp[0, 1, 1] = U, V   # plane xz: ch0 = x, ch1 = z
tp[0, 2, 0], tp[0, 2, 1] = U, V   # plane yz: ch0 = y, ch1 = z
const = nh.from_array(tp, "planes")
g = h.make_graph([
    h.make_node("ReduceMean", ["image"], ["m"], keepdims=0),
    h.make_node("Mul", ["m", "zero"], ["z0"]),
    h.make_node("Add", ["planes", "z0"], ["triplane"]),
], "triplane", [h.make_tensor_value_info("image", T.FLOAT, [1, 3, 512, 512])],
   [h.make_tensor_value_info("triplane", T.FLOAT, [1, 3, 40, P, P])], [const, nh.from_array(np.array(0, np.float32), "zero")])
m = h.make_model(g, opset_imports=[h.make_opsetid("", 17)]); m.ir_version = 8
onnx.save_model(m, f"{out}/triplane_q8.onnx", save_as_external_data=True, all_tensors_to_one_file=True, location="triplane_q8.onnx.data", size_threshold=0)

def col(i, name):
    return [h.make_node("Gather", ["features", f"i{i}"], [name], axis=1)]
inits = [nh.from_array(np.array([i], np.int64), f"i{i}") for i in (0, 1, 41)]
k = lambda n, v: nh.from_array(np.array(v, np.float32), n)
inits += [k("c25", 25.0), k("c10", 10.0), k("r1", 0.5), k("nx", 0.55), k("nz", 0.1), k("r2", 0.16), k("c30", 30.0),
          k("pz", -0.62), k("pt", 0.03), k("pr", 0.8), k("big", 400.0), k("one", 1.0), k("zero3", np.zeros((1, 3), np.float32))]
nodes = col(0, "x") + col(1, "y") + col(41, "z")
nodes += [
    h.make_node("Mul", ["x", "x"], ["xx"]), h.make_node("Mul", ["y", "y"], ["yy"]), h.make_node("Mul", ["z", "z"], ["zz"]),
    h.make_node("Add", ["xx", "yy"], ["xy2"]), h.make_node("Add", ["xy2", "zz"], ["r2a"]), h.make_node("Sqrt", ["r2a"], ["ra"]),
    h.make_node("Sub", ["r1", "ra"], ["da"]), h.make_node("Mul", ["da", "c10"], ["ea"]), h.make_node("Exp", ["ea"], ["fa"]), h.make_node("Mul", ["fa", "c25"], ["ball"]),
    h.make_node("Sub", ["x", "nx"], ["xn"]), h.make_node("Sub", ["z", "nz"], ["zn"]), h.make_node("Mul", ["xn", "xn"], ["xn2"]), h.make_node("Mul", ["zn", "zn"], ["zn2"]),
    h.make_node("Add", ["xn2", "yy"], ["t1"]), h.make_node("Add", ["t1", "zn2"], ["t2"]), h.make_node("Sqrt", ["t2"], ["rb"]),
    h.make_node("Sub", ["r2", "rb"], ["db"]), h.make_node("Mul", ["db", "c30"], ["eb"]), h.make_node("Exp", ["eb"], ["fb"]), h.make_node("Mul", ["fb", "c25"], ["nose"]),
    # thin plate: |z - pz| < pt and x^2+y^2 < pr^2  ->  big
    h.make_node("Sub", ["z", "pz"], ["zp"]), h.make_node("Abs", ["zp"], ["azp"]), h.make_node("Less", ["azp", "pt"], ["inz"]),
    h.make_node("Sqrt", ["xy2"], ["rxy"]), h.make_node("Less", ["rxy", "pr"], ["inr"]), h.make_node("And", ["inz", "inr"], ["inp"]),
    h.make_node("Cast", ["inp"], ["inpf"], to=T.FLOAT), h.make_node("Mul", ["inpf", "big"], ["plate"]),
    h.make_node("Add", ["ball", "nose"], ["s1"]), h.make_node("Add", ["s1", "plate"], ["density"]),
    h.make_node("Mul", ["density", "zero3"], ["color"]),
]
g = h.make_graph(nodes, "decoder", [h.make_tensor_value_info("features", T.FLOAT, ["N", 120])],
                 [h.make_tensor_value_info("density", T.FLOAT, ["N", 1]), h.make_tensor_value_info("color", T.FLOAT, ["N", 3])], inits)
m = h.make_model(g, opset_imports=[h.make_opsetid("", 17)]); m.ir_version = 8
onnx.checker.check_model(m); onnx.save_model(m, f"{out}/decoder.onnx")
import onnxruntime as ort
s = ort.InferenceSession(f"{out}/decoder.onnx"); f = np.zeros((3, 120), np.float32); f[1, 0] = 0.9; f[2, 41] = -0.62
print("decoder", s.run(None, {"features": f})[0].ravel())
s = ort.InferenceSession(f"{out}/triplane_q8.onnx"); print("triplane", s.run(None, {"image": np.zeros((1, 3, 512, 512), np.float32)})[0].shape)
